import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { sweepDueFunds, finalizeSweep, reclaimStuckSweeps, formatPrice } from '@/lib/wallet'
import type { WalletUserType } from '@/lib/wallet'
import { initiateTransfer } from '@/lib/paystack/transfer'
import { getControls } from '@/lib/controls'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import crypto from 'crypto'
import { beneficiaryTypeFromRole, loadPaymentBeneficiaryProfile, paymentProfilesEnvironment } from '@/lib/payment-profiles'
import {
  createPayoutBatch,
  createPayoutBatchItem,
  recordPayoutTransferAttempt,
  markPayoutTransferAttemptStatus,
  markPayoutBatchStatus,
  markPayoutBatchItemStatus,
} from '@/lib/payout-batches'

// 48-HOUR AUTO-SWEEP (migration 075). Every ~15 min: for each vendor/rider with
// funds that finished their hold and sat WITHDRAWABLE past the 48h window, force a
// Paystack transfer to their registered bank.
//
// Safety:
//   - Respects the super-admin kill switches (withdrawals_frozen / payouts_mode).
//   - Only sweeps when a VERIFIED bank is on file and is past its 24h cooling.
//   - sweep_due_funds stages atomically under the wallet lock (lots flip to
//     SWEEPING) so a manual withdrawal and the sweep can never grab the same
//     funds - no double payout.
//   - A failed transfer rolls back to WITHDRAWABLE (finalize_sweep) - money is
//     never lost - and is retried next run. Admin is alerted after N failures.
//   - Unique reference per attempt; stranded sweeps (crash before the transfer
//     fired) are reclaimed each run.

const RECLAIM_AFTER_MIN = 30
const COOLING_MS = 24 * 3_600_000
const MAX_USERS_PER_RUN = 500

interface WalletRow {
  user_id: string
  user_type: WalletUserType
  is_frozen: boolean
  bank_verified_at: string | null
  bank_account_number: string | null
  bank_code: string | null
  bank_account_name: string | null
  bank_name: string | null
  bank_account_last4: string | null
  last_bank_added_at: string | null
  sweep_fail_count: number | null
}

export async function GET(req: NextRequest) {
  return withCronHealth('wallet-sweep', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const controls = await getControls(true)
  if (controls.withdrawals_frozen || controls.payouts_mode !== 'auto') {
    return NextResponse.json({
      swept: 0,
      skipped: 'payouts_disabled',
      payouts_mode: controls.payouts_mode,
      withdrawals_frozen: controls.withdrawals_frozen,
    })
  }

  const db = createSupabaseAdmin()
  const reclaimed = await reclaimStuckSweeps(RECLAIM_AFTER_MIN).catch(() => 0)
  const { data: alertRow } = await db.from('settings').select('value').eq('id', 'sweep_fail_alert_at').maybeSingle()
  const failAlertAt = Number((alertRow as { value?: { count?: number } } | null)?.value?.count) || 3
  const adminPhone = process.env.ADMIN_PHONE

  const nowIso = new Date().toISOString()
  const { data: dueLots } = await db
    .from('wallet_payout_lots')
    .select('user_id, user_type')
    .eq('state', 'WITHDRAWABLE')
    .lte('sweep_due_at', nowIso)
    .limit(5000)

  const candidates = new Map<string, { userId: string; userType: WalletUserType }>()
  for (const r of (dueLots ?? []) as Array<{ user_id: string; user_type: WalletUserType }>) {
    const key = `${r.user_id}:${r.user_type}`
    if (!candidates.has(key)) candidates.set(key, { userId: r.user_id, userType: r.user_type })
    if (candidates.size >= MAX_USERS_PER_RUN) break
  }

  let swept = 0
  let sweptAmount = 0
  let failed = 0
  const skips: Record<string, number> = {}
  const bump = (k: string) => { skips[k] = (skips[k] ?? 0) + 1 }

  for (const { userId, userType } of candidates.values()) {
    const { data: wRaw } = await db
      .from('wallet_balances')
      .select('user_id, user_type, is_frozen, bank_verified_at, bank_account_number, bank_code, bank_account_name, bank_name, bank_account_last4, last_bank_added_at, sweep_fail_count')
      .eq('user_id', userId)
      .eq('user_type', userType)
      .maybeSingle()
    const wallet = wRaw as unknown as WalletRow | null
    if (!wallet) { bump('no_wallet'); continue }

    if (wallet.is_frozen) { bump('frozen'); continue }
    if (!wallet.bank_verified_at || !wallet.bank_account_number || !wallet.bank_code) { bump('no_verified_bank'); continue }
    if (wallet.last_bank_added_at && Date.now() - new Date(wallet.last_bank_added_at).getTime() < COOLING_MS) { bump('bank_cooling'); continue }

    const reference = `SWP-${userId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    let staged: { txId: string | null; sweptAmount: number; lotCount: number }
    try {
      staged = await sweepDueFunds({ userId, userType, reference })
    } catch (err) {
      bump('stage_error')
      console.error('[cron/wallet-sweep] stage failed', userId, err instanceof Error ? err.message : err)
      continue
    }
    if (!staged.txId || staged.sweptAmount <= 0) { bump('nothing_due'); continue }

    const txId = staged.txId
    const environment = paymentProfilesEnvironment()
    const beneficiaryType = beneficiaryTypeFromRole(userType.toLowerCase())
    const paymentProfile = await loadPaymentBeneficiaryProfile(db, {
      beneficiaryType,
      beneficiaryId: userId,
      environment,
    })

    if (!paymentProfile || paymentProfile.status !== 'ACTIVE' || paymentProfile.verification_status !== 'VERIFIED' || !paymentProfile.paystack_recipient_code) {
      bump('profile_missing')
      await finalizeSweep({ txId, success: false, reason: 'No verified payout profile' }).catch(() => {})
      continue
    }

    const batchReference = `BATCH-${userType.slice(0, 1)}-${userId.slice(0, 8)}-${reference.slice(-8)}`
    const transferReference = `TRF-${userType.slice(0, 1)}-${userId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    let payoutBatchCreated = false
    let transferCode: string | null = null

    try {
      const { batch } = await createPayoutBatch(db, {
        batchReference,
        beneficiaryType,
        beneficiaryId: userId,
        environment,
        currency: 'NGN',
        totalAmountKobo: staged.sweptAmount,
        itemCount: 1,
        killSwitchSnapshot: JSON.stringify({
          withdrawals_frozen: controls.withdrawals_frozen,
          payouts_mode: controls.payouts_mode,
        }),
        metadata: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          wallet_tx_id: txId,
          lots: staged.lotCount,
        },
      })
      payoutBatchCreated = true

      const { item } = await createPayoutBatchItem(db, {
        batchId: batch.id,
        beneficiaryType,
        beneficiaryId: userId,
        paymentProfileId: paymentProfile.id,
        amountKobo: staged.sweptAmount,
        currency: 'NGN',
        environment,
        bankName: paymentProfile.bank_name,
        bankCode: paymentProfile.bank_code,
        bankAccountLast4: paymentProfile.bank_account_last4,
        bankAccountMasked: paymentProfile.bank_account_masked,
        bankAccountName: paymentProfile.bank_account_name,
        paystackRecipientCode: paymentProfile.paystack_recipient_code,
        paystackSubaccountCode: paymentProfile.paystack_subaccount_code,
        transferReference,
        snapshotMetadata: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          wallet_tx_id: txId,
        },
      })

      await recordPayoutTransferAttempt(db, {
        payoutBatchItemId: item.id,
        transferReference,
        providerPayload: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          batch_reference: batchReference,
        },
      })

      transferCode = await initiateTransfer({
        amount: staged.sweptAmount,
        recipient_code: paymentProfile.paystack_recipient_code,
        reference: transferReference,
        reason: `LumeX Fud auto-payout - ${userType.toLowerCase()}`,
      })

      await markPayoutBatchStatus(db, {
        batchReference,
        status: 'IN_PROGRESS',
        killSwitchSnapshot: JSON.stringify({
          withdrawals_frozen: controls.withdrawals_frozen,
          payouts_mode: controls.payouts_mode,
        }),
        metadata: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          wallet_tx_id: txId,
          transfer_reference: transferReference,
          transfer_code: transferCode,
        },
      })
      await markPayoutBatchItemStatus(db, {
        transferReference,
        status: 'PENDING',
        paystackTransferCode: transferCode,
        snapshotMetadata: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          wallet_tx_id: txId,
          transfer_code: transferCode,
        },
      })
      await markPayoutTransferAttemptStatus(db, {
        transferReference,
        status: 'PENDING',
        transferCode,
        providerPayload: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          batch_reference: batchReference,
          transfer_code: transferCode,
        },
      })

      await db
        .from('wallet_transactions')
        .update({
          paystack_transfer_code: transferCode,
          paystack_recipient_code: paymentProfile.paystack_recipient_code,
        })
        .eq('id', txId)

      swept += 1
      sweptAmount += staged.sweptAmount

      await audit({
        actor_id: 'cron',
        actor_role: 'system',
        action: 'WALLET_SWEEP',
        target_table: 'wallet_balances',
        target_id: userId,
        new_value: {
          user_type: userType,
          amount_kobo: staged.sweptAmount,
          reference,
          transfer_code: transferCode,
          transfer_reference: transferReference,
          batch_reference: batchReference,
          lots: staged.lotCount,
          bank_last_4: paymentProfile.bank_account_last4,
        },
      })

      try {
        const table = userType === 'VENDOR' ? 'vendors' : 'riders'
        const { data: ur } = await db.from(table).select('phone').eq('id', userId).maybeSingle()
        const phone = (ur as unknown as { phone?: string } | null)?.phone
        if (phone) {
          sendWhatsAppWithFallback({
            to: phone,
            message: `${formatPrice(staged.sweptAmount)} has been automatically paid out to your ${paymentProfile.bank_name ?? 'bank'} ****${paymentProfile.bank_account_last4 ?? ''}. Funds left unwithdrawn for 48h are sent to your registered account.\nRef: ${reference}`,
          }).catch(() => {})
        }
      } catch {
        /* notification is non-critical */
      }
    } catch (err) {
      failed += 1
      const reason = err instanceof Error ? err.message : 'Transfer failed'

      if (payoutBatchCreated) {
        await markPayoutBatchStatus(db, {
          batchReference,
          status: 'FAILED',
          killSwitchSnapshot: JSON.stringify({
            withdrawals_frozen: controls.withdrawals_frozen,
            payouts_mode: controls.payouts_mode,
          }),
          metadata: {
            source: 'wallet_sweep',
            sweep_reference: reference,
            wallet_tx_id: txId,
            transfer_reference: transferReference,
            transfer_code: transferCode,
            failure_reason: reason.slice(0, 300),
          },
        }).catch(() => {})
      }

      await markPayoutBatchItemStatus(db, {
        transferReference,
        status: 'FAILED',
        paystackTransferCode: transferCode,
        snapshotMetadata: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          wallet_tx_id: txId,
          failure_reason: reason.slice(0, 300),
        },
      }).catch(() => {})
      await markPayoutTransferAttemptStatus(db, {
        transferReference,
        status: 'FAILED',
        transferCode,
        failureReason: reason,
        providerPayload: {
          source: 'wallet_sweep',
          sweep_reference: reference,
          batch_reference: batchReference,
          failure_reason: reason,
        },
      }).catch(() => {})

      await finalizeSweep({ txId, success: false, reason }).catch(() => {})

      const prevFails = wallet.sweep_fail_count ?? 0
      const newFails = prevFails + 1
      console.error('[cron/wallet-sweep] transfer failed', userId, reason)
      if (adminPhone && prevFails < failAlertAt && newFails >= failAlertAt) {
        sendWhatsAppWithFallback({
          to: adminPhone,
          message: `ALERT: LumeX auto-sweep has failed ${newFails}x for ${userType} ${userId.slice(0, 8)}. ${formatPrice(staged.sweptAmount)} held back (funds safe). Check their bank details / Paystack. Reason: ${reason.slice(0, 100)}`,
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ swept, swept_amount: sweptAmount, failed, reclaimed, candidates: candidates.size, skips })
}
