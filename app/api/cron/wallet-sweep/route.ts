import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { sweepDueFunds, finalizeSweep, reclaimStuckSweeps, formatPrice } from '@/lib/wallet'
import type { WalletUserType } from '@/lib/wallet'
import { createTransferRecipient, initiateTransfer } from '@/lib/paystack/transfer'
import { decryptField } from '@/lib/crypto'
import { getControls } from '@/lib/controls'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import crypto from 'crypto'

// 48-HOUR AUTO-SWEEP (migration 075). Every ~15 min: for each vendor/rider with
// funds that finished their hold and sat WITHDRAWABLE past the 48h window, force a
// Paystack transfer to their registered bank.
//
// Safety:
//   • Respects the super-admin kill switches (withdrawals_frozen / payouts_mode).
//   • Only sweeps when a VERIFIED bank is on file and is past its 24h cooling.
//   • sweep_due_funds stages atomically under the wallet lock (lots flip to
//     SWEEPING) so a manual withdrawal and the sweep can never grab the same
//     funds — no double payout.
//   • A failed transfer rolls back to WITHDRAWABLE (finalize_sweep) — money is
//     never lost — and is retried next run. Admin is alerted after N failures.
//   • Unique reference per attempt; stranded sweeps (crash before the transfer
//     fired) are reclaimed each run.

const RECLAIM_AFTER_MIN = 30      // un-stick sweeps that never reached Paystack
const COOLING_MS = 24 * 3_600_000 // mirror the manual-withdrawal new-bank cooling
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

  // The sweep is a payout — obey the same kill switches as manual withdrawals and
  // the auto-release cron. Don't move money while frozen / in manual payouts mode.
  const controls = await getControls(true)
  if (controls.withdrawals_frozen || controls.payouts_mode !== 'auto') {
    return NextResponse.json({ swept: 0, skipped: 'payouts_disabled', payouts_mode: controls.payouts_mode, withdrawals_frozen: controls.withdrawals_frozen })
  }

  const db = createSupabaseAdmin()

  // 0. Reclaim sweeps stranded mid-flight (crash before the Paystack call).
  const reclaimed = await reclaimStuckSweeps(RECLAIM_AFTER_MIN).catch(() => 0)

  // Fail-after-N alert threshold (live-tunable).
  const { data: alertRow } = await db.from('settings').select('value').eq('id', 'sweep_fail_alert_at').maybeSingle()
  const failAlertAt = Number((alertRow as { value?: { count?: number } } | null)?.value?.count) || 3
  const adminPhone = process.env.ADMIN_PHONE

  // 1. Candidate users: anyone with a due, still-withdrawable lot.
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
    // 2. Load the wallet + bank destination.
    const { data: wRaw } = await db
      .from('wallet_balances')
      .select('user_id, user_type, is_frozen, bank_verified_at, bank_account_number, bank_code, bank_account_name, bank_name, bank_account_last4, last_bank_added_at, sweep_fail_count')
      .eq('user_id', userId)
      .eq('user_type', userType)
      .maybeSingle()
    const wallet = wRaw as unknown as WalletRow | null
    if (!wallet) { bump('no_wallet'); continue }

    // 3. Gating — only sweep to a verified, settled bank (mirrors withdraw rules).
    if (wallet.is_frozen) { bump('frozen'); continue }
    if (!wallet.bank_verified_at || !wallet.bank_account_number || !wallet.bank_code) { bump('no_verified_bank'); continue }
    if (wallet.last_bank_added_at && Date.now() - new Date(wallet.last_bank_added_at).getTime() < COOLING_MS) { bump('bank_cooling'); continue }

    // 4. Stage the sweep atomically (lots → SWEEPING, pool debited, PENDING tx).
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

    // 5. Fire the transfer; commit or roll back.
    try {
      const recipientCode = await createTransferRecipient({
        name:           wallet.bank_account_name ?? 'Account Holder',
        account_number: decryptField(wallet.bank_account_number),
        bank_code:      wallet.bank_code,
      })
      const transferCode = await initiateTransfer({
        amount:         staged.sweptAmount,
        recipient_code: recipientCode,
        reference,
        reason:         `LumeX Fud auto-payout — ${userType.toLowerCase()}`,
      })

      await finalizeSweep({ txId, success: true, transferCode, recipientCode })
      swept += 1
      sweptAmount += staged.sweptAmount

      await audit({
        actor_id:     'cron',
        actor_role:   'system',
        action:       'WALLET_SWEEP',
        target_table: 'wallet_balances',
        target_id:    userId,
        new_value:    { user_type: userType, amount_kobo: staged.sweptAmount, reference, transfer_code: transferCode, lots: staged.lotCount, bank_last_4: wallet.bank_account_last4 },
      })

      // Notify the earner (best-effort).
      try {
        const table = userType === 'VENDOR' ? 'vendors' : 'riders'
        const { data: ur } = await db.from(table).select('phone').eq('id', userId).maybeSingle()
        const phone = (ur as unknown as { phone?: string } | null)?.phone
        if (phone) {
          sendWhatsAppWithFallback({
            to: phone,
            message: `${formatPrice(staged.sweptAmount)} has been automatically paid out to your ${wallet.bank_name ?? 'bank'} ****${wallet.bank_account_last4 ?? ''}. Funds left unwithdrawn for 48h are sent to your registered account.\nRef: ${reference}`,
          }).catch(() => {})
        }
      } catch { /* notification is non-critical */ }
    } catch (err) {
      // Transfer failed — roll back so the funds stay withdrawable + retry later.
      failed += 1
      const reason = err instanceof Error ? err.message : 'Transfer failed'
      await finalizeSweep({ txId, success: false, reason }).catch(() => {})

      const prevFails = wallet.sweep_fail_count ?? 0
      const newFails = prevFails + 1
      console.error('[cron/wallet-sweep] transfer failed', userId, reason)
      // Alert admin exactly when crossing the failure threshold (no per-run spam).
      if (adminPhone && prevFails < failAlertAt && newFails >= failAlertAt) {
        sendWhatsAppWithFallback({
          to: adminPhone,
          message: `⚠️ LumeX auto-sweep has failed ${newFails}x for ${userType} ${userId.slice(0, 8)}. ${formatPrice(staged.sweptAmount)} held back (funds safe). Check their bank details / Paystack. Reason: ${reason.slice(0, 100)}`,
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ swept, swept_amount: sweptAmount, failed, reclaimed, candidates: candidates.size, skips })
}
