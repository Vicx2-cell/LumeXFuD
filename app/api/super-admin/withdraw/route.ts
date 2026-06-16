import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createTransferRecipient, initiateTransfer } from '@/lib/paystack/transfer'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { requireStepUpForAmount } from '@/lib/step-up'
import { z } from 'zod'
import crypto from 'crypto'

// Minimum ₦500 withdrawal, max ₦10,000,000 (₦100k) per request
const withdrawSchema = z.object({
  amount_kobo: z
    .number()
    .int()
    .min(50_000,       'Minimum withdrawal is ₦500')
    .max(10_000_000_00, 'Maximum single withdrawal is ₦100,000'),
  note:      z.string().max(200).optional(),
  confirmed: z.boolean().default(false), // true = user accepted safety warning
  reauth_pin: z.string().optional(),     // 6-digit login PIN — required for ≥ ₦50k (rule #28)
})

/** Fetch live NGN balance from Paystack. Returns 0 on error. */
async function fetchPaystackBalance(): Promise<number> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return 0
  try {
    const res = await fetch('https://api.paystack.co/balance', {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return 0
    const json = (await res.json()) as {
      status: boolean
      data: Array<{ currency: string; balance: number }>
    }
    return json.data?.find((d) => d.currency === 'NGN')?.balance ?? 0
  } catch {
    return 0
  }
}

// POST /api/super-admin/withdraw
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Founder payout — very strict cap (3 / 10 min) even though it's super-admin only.
  const rl = await rateLimitGeneric(`super-withdraw:${session.userId ?? session.phone}`, 3, 600, true)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many withdrawal attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = withdrawSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { amount_kobo, note, confirmed } = parsed.data

  // Rule #28: re-authenticate (fresh login PIN) for any payout ≥ ₦50,000. A valid
  // super-admin session alone is not enough to move founder funds.
  const stepUp = await requireStepUpForAmount(session, amount_kobo, parsed.data.reauth_pin)
  if (!stepUp.ok) {
    return NextResponse.json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
  }

  // Founder bank details — required env vars
  const founderBankCode = process.env.FOUNDER_BANK_CODE
  const founderAccount  = process.env.FOUNDER_ACCOUNT_NUMBER
  const founderName     = process.env.FOUNDER_ACCOUNT_NAME ?? 'Chibuike Iheanyichi'

  if (!founderBankCode || !founderAccount) {
    return NextResponse.json(
      { error: 'Founder bank details not configured. Set FOUNDER_BANK_CODE and FOUNDER_ACCOUNT_NUMBER in environment.' },
      { status: 500 }
    )
  }

  const db = createSupabaseAdmin()

  // Fetch all wallet floats + live Paystack balance for safety check
  const [walletsRes, customerWalletsRes, paystackBalance] = await Promise.all([
    db.from('wallet_balances').select('user_type, available_balance'),
    db.from('customer_wallets').select('balance_kobo'),
    fetchPaystackBalance(),
  ])

  const wallets = walletsRes.data ?? []
  const vendorAvailable   = wallets
    .filter((w) => w.user_type === 'VENDOR')
    .reduce((s, w) => s + (w.available_balance ?? 0), 0)
  const riderAvailable    = wallets
    .filter((w) => w.user_type === 'RIDER')
    .reduce((s, w) => s + (w.available_balance ?? 0), 0)
  const customerTotal     = (customerWalletsRes.data ?? [])
    .reduce((s, w) => s + (w.balance_kobo ?? 0), 0)

  // Minimum safe Paystack balance = all vendor + rider + customer floats + ₦2,000 emergency buffer
  const EMERGENCY_BUFFER_KOBO = 200_000
  const minSafeBalance        = vendorAvailable + riderAvailable + customerTotal + EMERGENCY_BUFFER_KOBO
  const remainingAfterKobo    = paystackBalance - amount_kobo

  // Hard stop: Paystack doesn't have enough
  if (paystackBalance < amount_kobo) {
    return NextResponse.json(
      {
        error: `Insufficient Paystack balance. Available: ₦${(paystackBalance / 100).toLocaleString('en-NG')}.`,
        paystack_balance_kobo: paystackBalance,
      },
      { status: 400 }
    )
  }

  // Soft warning: withdrawal leaves less than the safe minimum
  if (remainingAfterKobo < minSafeBalance && !confirmed) {
    return NextResponse.json(
      {
        warning:               true,
        message:
          `⚠️ Withdrawing ₦${(amount_kobo / 100).toLocaleString('en-NG')} leaves only ` +
          `₦${(remainingAfterKobo / 100).toLocaleString('en-NG')} in Paystack. ` +
          `Vendors and riders need ₦${(minSafeBalance / 100).toLocaleString('en-NG')} available. ` +
          `Set confirmed=true to proceed anyway.`,
        paystack_balance_kobo:     paystackBalance,
        min_safe_balance_kobo:     minSafeBalance,
        remaining_after_kobo:      remainingAfterKobo,
        vendor_float_kobo:         vendorAvailable,
        rider_float_kobo:          riderAvailable,
        customer_float_kobo:       customerTotal,
      },
      { status: 422 }
    )
  }

  // Create transfer recipient (Paystack deduplicates by account + bank_code)
  let recipientCode: string
  try {
    recipientCode = await createTransferRecipient({
      name:           founderName,
      account_number: founderAccount,
      bank_code:      founderBankCode,
    })
  } catch (err) {
    console.error('[withdraw] createTransferRecipient failed:', err)
    return NextResponse.json(
      { error: `Failed to create transfer recipient: ${String(err)}` },
      { status: 500 }
    )
  }

  // Initiate transfer
  const reference = `FOUNDER-WD-${crypto.randomUUID().slice(0, 8).toUpperCase()}-${Date.now()}`
  let transferCode: string
  try {
    transferCode = await initiateTransfer({
      amount:         amount_kobo,
      recipient_code: recipientCode,
      reference,
      reason:         note ?? 'Founder earnings withdrawal — LumeX Fud',
    })
  } catch (err) {
    console.error('[withdraw] initiateTransfer failed:', err)
    return NextResponse.json(
      { error: `Paystack transfer failed: ${String(err)}` },
      { status: 500 }
    )
  }

  // Log to super_audit_logs
  void superAudit({
    actor_id:    session.phone,
    actor_role:  session.role,
    action:      'founder_withdrawal',
    amount_kobo,
    new_value: {
      reference,
      transfer_code:            transferCode,
      note:                     note ?? null,
      paystack_balance_before:  paystackBalance,
      remaining_after:          remainingAfterKobo,
      confirmed,
    },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({
    success:       true,
    transfer_code: transferCode,
    reference,
    amount_kobo,
    note:          note ?? null,
  })
}
