import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import {
  verifyWalletPin, debitWalletWithdrawal, reverseWithdrawal, formatPrice,
} from '@/lib/wallet'
import { createTransferRecipient, initiateTransfer } from '@/lib/paystack/transfer'
import { decryptField } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'
import type { WalletBalance } from '@/lib/wallet'
import crypto from 'crypto'

const MIN_KOBO   = 50_000   // ₦500
const MAX_KOBO   = 2_500_000 // ₦25,000
const DAILY_LIMIT_KOBO  = 5_000_000  // ₦50,000
const WEEKLY_LIMIT_KOBO = 20_000_000 // ₦200,000

const schema = z.object({
  amount_naira: z.number().int().min(500).max(25_000),
  wallet_pin:   z.string().length(4).regex(/^\d{4}$/),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Money out — very strict cap per user (3 / 10 min) to blunt account-takeover
  // payout drains. No-ops if Upstash is unset.
  const rl = await rateLimitGeneric(`wallet-withdraw:${session.userId ?? session.phone}`, 3, 600, true)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many withdrawal attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { amount_naira, wallet_pin } = parsed.data
  const amountKobo = amount_naira * 100
  const userType = session.role === 'vendor' ? 'VENDOR' : 'RIDER'
  const db = createSupabaseAdmin()

  // ── 0. Self-healing release ─────────────────────────────────────────────────
  // Release any DUE held funds → available BEFORE the balance check, so a user
  // can always withdraw money that's past its hold even if the 5-min release cron
  // never ran (the bug that stranded ₦100k+ for riders/vendors). Idempotent.
  await db.rpc('release_held_batch').then(() => {}, () => {})

  // ── 1. Load wallet ──────────────────────────────────────────────────────────
  const { data: walletRaw } = await db
    .from('wallet_balances')
    .select(
      'wallet_pin_hash, pin_attempts, pin_locked_until, ' +
      'is_frozen, frozen_reason, ' +
      'bank_account_number, bank_account_last4, bank_code, bank_account_name, bank_name, last_bank_added_at, ' +
      'available_balance'
    )
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .maybeSingle()

  const wallet = walletRaw as unknown as WalletBalance | null

  // ── 2. Must have PIN set ────────────────────────────────────────────────────
  if (!wallet?.wallet_pin_hash) {
    return NextResponse.json({ error: 'Set a wallet PIN first before withdrawing.' }, { status: 403 })
  }

  // ── 3. PIN lockout check ────────────────────────────────────────────────────
  if (wallet.pin_locked_until && new Date(wallet.pin_locked_until) > new Date()) {
    return NextResponse.json(
      { error: 'Wallet PIN locked due to too many wrong attempts. Contact support or wait 30 minutes.' },
      { status: 429 }
    )
  }

  // ── 4. Verify wallet PIN ────────────────────────────────────────────────────
  const pinOk = await verifyWalletPin(wallet_pin, wallet.wallet_pin_hash)
  if (!pinOk) {
    const newAttempts = (wallet.pin_attempts ?? 0) + 1
    const updates: Record<string, unknown> = { pin_attempts: newAttempts }
    if (newAttempts >= 5) {
      updates.pin_locked_until = new Date(Date.now() + 30 * 60_000).toISOString()
      // Alert admin via WhatsApp
      const adminPhone = process.env.ADMIN_PHONE
      if (adminPhone) {
        sendWhatsAppWithFallback({
          to: adminPhone,
          message: `ALERT: Wallet PIN locked for user ${session.userId} (${userType}) after 5 failed attempts.`,
        }).catch(() => {})
      }
    }
    await db.from('wallet_balances').update(updates)
      .eq('user_id', session.userId!).eq('user_type', userType)
    const left = Math.max(0, 5 - newAttempts)
    return NextResponse.json(
      { error: `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} remaining.` },
      { status: 401 }
    )
  }

  // ── 5. Wallet frozen? ───────────────────────────────────────────────────────
  if (wallet.is_frozen) {
    return NextResponse.json(
      { error: 'Your wallet is frozen. Contact support.' },
      { status: 403 }
    )
  }

  // ── 6. Bank account connected? ──────────────────────────────────────────────
  if (!wallet.bank_account_number || !wallet.bank_code) {
    return NextResponse.json({ error: 'Add a bank account first.' }, { status: 400 })
  }

  // ── 7. 24-hour cooling period ───────────────────────────────────────────────
  if (wallet.last_bank_added_at) {
    const coolingExpires = new Date(new Date(wallet.last_bank_added_at).getTime() + 24 * 3_600_000)
    if (coolingExpires > new Date()) {
      return NextResponse.json(
        {
          error: `New bank account — withdrawals available from ${coolingExpires.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`,
        },
        { status: 400 }
      )
    }
  }

  // ── 8. Platform withdrawals frozen? ────────────────────────────────────────
  const { data: setting } = await db
    .from('settings')
    .select('value')
    .eq('id', 'withdrawals_frozen')
    .maybeSingle()
  if (setting?.value === true || setting?.value === 'true') {
    return NextResponse.json(
      { error: 'Withdrawals temporarily suspended. Contact support.' },
      { status: 503 }
    )
  }

  // ── 9. Daily limit check ───────────────────────────────────────────────────
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data: dailyTxs } = await db
    .from('wallet_transactions')
    .select('amount')
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .eq('type', 'WITHDRAWAL')
    .not('status', 'in', '("FAILED","REVERSED")')
    .gte('created_at', todayStart.toISOString())

  const dailyTotal = (dailyTxs ?? []).reduce((sum, tx) => sum + Number((tx as { amount: number }).amount), 0)
  if (dailyTotal + amountKobo > DAILY_LIMIT_KOBO) {
    return NextResponse.json(
      { error: `Daily withdrawal limit (${formatPrice(DAILY_LIMIT_KOBO)}) reached. Try again tomorrow.` },
      { status: 400 }
    )
  }

  // ── 10. Weekly limit check ─────────────────────────────────────────────────
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)

  const { data: weeklyTxs } = await db
    .from('wallet_transactions')
    .select('amount')
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .eq('type', 'WITHDRAWAL')
    .not('status', 'in', '("FAILED","REVERSED")')
    .gte('created_at', weekStart.toISOString())

  const weeklyTotal = (weeklyTxs ?? []).reduce((sum, tx) => sum + Number((tx as { amount: number }).amount), 0)
  if (weeklyTotal + amountKobo > WEEKLY_LIMIT_KOBO) {
    return NextResponse.json(
      { error: `Weekly withdrawal limit (${formatPrice(WEEKLY_LIMIT_KOBO)}) reached.` },
      { status: 400 }
    )
  }

  // ── 11. Atomic balance debit via Postgres RPC ──────────────────────────────
  const reference = `WD-${session.userId!.slice(0, 8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const last4 = wallet.bank_account_last4 ?? ''
  const description = `Withdrawal to ${wallet.bank_name ?? 'bank'} ****${last4}`

  // The daily/weekly caps are also enforced atomically inside the RPC (under the
  // wallet-row lock) so concurrent withdrawals can't slip past them — the checks
  // above are just fast-fail UX. Pass the same limits + period boundaries.
  const debitResult = await debitWalletWithdrawal({
    userId:      session.userId!,
    userType,
    amount:      amountKobo,
    reference,
    description,
    dailyLimit:  DAILY_LIMIT_KOBO,
    dailyStart:  todayStart.toISOString(),
    weeklyLimit: WEEKLY_LIMIT_KOBO,
    weeklyStart: weekStart.toISOString(),
  })

  if (!debitResult.success) {
    return NextResponse.json({ error: debitResult.errorMsg ?? 'Withdrawal failed' }, { status: 400 })
  }

  const txId = debitResult.txId

  // ── 12. Paystack Transfer ──────────────────────────────────────────────────
  let transferCode: string | null = null
  try {
    const recipientCode = await createTransferRecipient({
      name:           wallet.bank_account_name ?? session.name ?? 'Account Holder',
      account_number: decryptField(wallet.bank_account_number), // decrypt only here, at payout
      bank_code:      wallet.bank_code,
    })

    transferCode = await initiateTransfer({
      amount:         amountKobo,
      recipient_code: recipientCode,
      reference,
      reason:         `LumeX Fud payout — ${userType.toLowerCase()}`,
    })

    // Update transaction with transfer code
    await db
      .from('wallet_transactions')
      .update({
        status:                   'COMPLETED',
        paystack_transfer_code:   transferCode,
        paystack_recipient_code:  recipientCode,
      })
      .eq('id', txId)

    await db
      .from('wallet_balances')
      .update({ pin_attempts: 0 })
      .eq('user_id', session.userId!)
      .eq('user_type', userType)

  } catch (err) {
    // Paystack call failed — atomically reverse the debit
    await reverseWithdrawal(txId, String(err))

    // Alert admin
    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone) {
      sendWhatsAppWithFallback({
        to: adminPhone,
        message: `ALERT: Paystack transfer failed for ${userType} ${session.userId}. ₦${amount_naira} reversed. Error: ${String(err).slice(0, 100)}`,
      }).catch(() => {})
    }

    // Notify user
    const table = session.role === 'vendor' ? 'vendors' : 'riders'
    const { data: ur } = await db.from(table).select('phone').eq('id', session.userId!).maybeSingle()
    const urCast = ur as unknown as { phone?: string } | null
    if (urCast?.phone) {
      sendWhatsAppWithFallback({
        to: urCast.phone,
        message: `Your withdrawal of ${formatPrice(amountKobo)} failed. Your balance has been fully restored. Please try again later.`,
      }).catch(() => {})
    }

    return NextResponse.json(
      { error: 'Transfer failed. Your balance has been restored.' },
      { status: 502 }
    )
  }

  // ── 13. Audit log ──────────────────────────────────────────────────────────
  await audit({
    actor_id:     session.phone,
    actor_role:   session.role,
    action:       'WALLET_WITHDRAWAL',
    target_table: 'wallet_balances',
    target_id:    session.userId!,
    new_value:    {
      amount_kobo:  amountKobo,
      reference,
      transfer_code: transferCode,
      bank_last_4:  last4,
    },
  })

  // ── 14. WhatsApp notification ──────────────────────────────────────────────
  const table = session.role === 'vendor' ? 'vendors' : 'riders'
  const { data: ur } = await db.from(table).select('phone').eq('id', session.userId!).maybeSingle()
  const urCast = ur as unknown as { phone?: string } | null
  if (urCast?.phone) {
    sendWhatsAppWithFallback({
      to: urCast.phone,
      message: `Withdrawal of ${formatPrice(amountKobo)} initiated to ${wallet.bank_name ?? 'your bank'} ****${last4}.\nShould arrive in a few minutes.\nRef: ${reference}`,
    }).catch(() => {})
  }

  return NextResponse.json({
    success:   true,
    reference,
    amount:    formatPrice(amountKobo),
    bank_name: wallet.bank_name,
    bank_last_4: last4,
  })
}
