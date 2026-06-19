import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { getTopupLimits, getTopupBonusPct, formatPrice } from '@/lib/customer-wallet'
import { getFeature } from '@/lib/features'
import { trackFeature } from '@/lib/usage'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'
import crypto from 'crypto'

// POST /api/sponsor-wallet/topup — PUBLIC. Lets anyone (a parent/sponsor) fund a
// student's LumeX wallet without logging in. It reuses the EXACT customer top-up
// money path: a Paystack transaction tagged metadata.type='WALLET_TOPUP' with the
// STUDENT's customer_id. The existing webhook (charge.success) re-verifies the
// amount with Paystack, credits that customer idempotently and notifies them — so
// no webhook/wallet change is needed and reconciliation is unchanged.
//
// Security: the only thing this lets an outsider do is GIVE a registered student
// money that can only be spent on food in-app (customer wallets can't be withdrawn
// to a bank), so the abuse surface is minimal. Rate-limited per IP, fails closed.

const schema = z.object({
  phone:        z.string().min(7).max(20),
  amount_naira: z.number().int().positive(),
  sponsor_name: z.string().trim().max(80).optional(),
}).strict()

export async function POST(req: NextRequest) {
  if (!(await getFeature('sponsor_topup'))) {
    return NextResponse.json({ error: 'This feature is currently unavailable.' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const rl = await rateLimitGeneric(`sponsor-topup:${ip}`, 10, 600, true)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid number and amount.' }, { status: 400 })
  }

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch {
    return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  const amountKobo = parsed.data.amount_naira * 100
  const limits = await getTopupLimits()
  if (amountKobo < limits.minKobo) return NextResponse.json({ error: `Minimum is ${formatPrice(limits.minKobo)}` }, { status: 400 })
  if (amountKobo > limits.maxKobo) return NextResponse.json({ error: `Maximum is ${formatPrice(limits.maxKobo)}` }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: cust } = await db
    .from('customers')
    .select('id, name')
    .eq('phone', phone)
    .is('deleted_at', null)
    .maybeSingle()
  const customer = cust as { id: string; name: string | null } | null
  if (!customer) {
    return NextResponse.json({ error: 'No LumeX student account uses that number. Check it and try again.' }, { status: 404 })
  }

  const bonusPct = await getTopupBonusPct()
  const bonusKobo = Math.floor((amountKobo * bonusPct) / 100)
  const reference = `TOPUP-${customer.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return NextResponse.json({ error: 'Payment not configured' }, { status: 500 })

  const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email:     `${phone.replace('+', '')}@lumexfud.com.ng`,
      amount:    amountKobo,
      reference,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/sponsor?status=success&ref=${reference}`,
      metadata: {
        // Same type the existing webhook handles — it credits this customer_id.
        type:           'WALLET_TOPUP',
        customer_id:    customer.id,
        customer_phone: phone,
        customer_name:  customer.name ?? '',
        bonus_pct:      bonusPct,
        bonus_kobo:     bonusKobo,
        sponsor_name:   parsed.data.sponsor_name ?? '',
        is_sponsor:     true,
        cancel_action:  'TOPUP_CANCELLED',
      },
    }),
  })

  if (!psRes.ok) {
    const e = await psRes.json().catch(() => ({})) as { message?: string }
    console.error('[sponsor-wallet/topup] Paystack error:', e)
    return NextResponse.json({ error: 'Payment initialization failed' }, { status: 502 })
  }
  const psData = await psRes.json() as { status: boolean; data: { authorization_url: string } }
  if (!psData.status) return NextResponse.json({ error: 'Paystack declined initialization' }, { status: 502 })

  // Only reveal the first name, so the form confirms the right person without
  // leaking the full identity behind a phone number.
  trackFeature('sponsor_topup', 'guest')
  const firstName = (customer.name ?? '').trim().split(/\s+/)[0] || 'this student'
  return NextResponse.json({
    authorization_url: psData.data.authorization_url,
    reference,
    student_first_name: firstName,
    amount_formatted: formatPrice(amountKobo),
  })
}
