import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getTopupLimits, getTopupBonusPct, formatPrice, isCustomerWalletEnabled } from '@/lib/customer-wallet'
import { trackFeature } from '@/lib/usage'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'
import crypto from 'crypto'

// POST /api/customer-wallet/topup
// Initializes a Paystack transaction for customer wallet top-up.
// The webhook (charge.success with metadata.type='WALLET_TOPUP') handles actual crediting.

const schema = z.object({
  amount_naira: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Kill switch (server perimeter): if the customer wallet is disabled no top-up
  // can be initialized, no matter what the client sends.
  if (!(await isCustomerWalletEnabled())) {
    return NextResponse.json({ error: 'The wallet is currently unavailable.', code: 'feature_disabled' }, { status: 403 })
  }

  // Rate limit: each top-up spins up a Paystack transaction — cap at 10 / 10 min
  // per user to stop init spam. No-ops if Upstash is unset.
  const rl = await rateLimitGeneric(`cwallet-topup:${session.userId ?? session.phone}`, 10, 600, true)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many top-up attempts. Please wait and try again.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { amount_naira } = parsed.data
  const amountKobo = amount_naira * 100

  // Validate amount against settings
  const limits = await getTopupLimits()
  if (amountKobo < limits.minKobo) {
    return NextResponse.json({
      error: `Minimum top-up is ${formatPrice(limits.minKobo)}`,
    }, { status: 400 })
  }
  if (amountKobo > limits.maxKobo) {
    return NextResponse.json({
      error: `Maximum top-up is ${formatPrice(limits.maxKobo)}`,
    }, { status: 400 })
  }

  const db = createSupabaseAdmin()

  // Resolve customer
  const { data: cust } = await db
    .from('customers')
    .select('id, name')
    .eq('phone', session.phone)
    .maybeSingle()
  const customer = cust as { id: string; name: string | null } | null
  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Calculate bonus to show user upfront
  const bonusPct = await getTopupBonusPct()
  const bonusKobo = Math.floor((amountKobo * bonusPct) / 100)

  // Generate unique reference
  const reference = `TOPUP-${customer.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  // Initialize Paystack transaction
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) {
    return NextResponse.json({ error: 'Payment not configured' }, { status: 500 })
  }

  const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // ".local" is not a real TLD — Paystack rejects it ("Invalid Email
      // Address Passed"). Use the platform's real domain so top-ups succeed.
      email:     `${session.phone.replace('+', '')}@lumexfud.com.ng`,
      amount:    amountKobo,
      reference,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/profile/wallet?topup=success`,
      metadata: {
        type:        'WALLET_TOPUP',
        customer_id:  customer.id,
        customer_phone: session.phone,
        customer_name:  customer.name ?? '',
        bonus_pct:    bonusPct,
        bonus_kobo:   bonusKobo,
        cancel_action: 'TOPUP_CANCELLED',
      },
    }),
  })

  if (!psRes.ok) {
    const e = await psRes.json().catch(() => ({})) as { message?: string }
    console.error('[customer-wallet/topup] Paystack error:', e)
    return NextResponse.json({ error: 'Payment initialization failed' }, { status: 502 })
  }

  const psData = await psRes.json() as { status: boolean; data: { authorization_url: string; access_code: string } }
  if (!psData.status) {
    return NextResponse.json({ error: 'Paystack declined initialization' }, { status: 502 })
  }

  trackFeature('wallet_topup', 'customer')
  return NextResponse.json({
    authorization_url: psData.data.authorization_url,
    reference,
    amount_kobo:       amountKobo,
    bonus_kobo:        bonusKobo,
    total_kobo:        amountKobo + bonusKobo,
    amount_formatted:  formatPrice(amountKobo),
    bonus_formatted:   bonusKobo > 0 ? formatPrice(bonusKobo) : null,
    total_formatted:   formatPrice(amountKobo + bonusKobo),
  })
}
