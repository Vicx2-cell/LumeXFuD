import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { requireStepUpForAmount } from '@/lib/step-up'

// Manual wallet credit/debit for any account. Money-sensitive: super_admin only,
// capped, requires a reason, fully audited, atomic via the migration-047 RPCs.

const MAX_KOBO = 50_000_000 // ±₦500,000 per adjustment (fat-finger guard)

const input = z.object({
  phone:        z.string().min(7).max(20),
  amount_naira: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero'),
  reason:       z.string().trim().min(3).max(300),
  reauth_pin:   z.string().optional(), // 6-digit login PIN — required for ≥ ₦50k (rule #28)
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Super admin only' }, { status: 403 })

  const rl = await rateLimitGeneric(`wallet-adjust:${session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = input.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })

  const amountKobo = parsed.data.amount_naira * 100
  if (Math.abs(amountKobo) > MAX_KOBO) {
    return NextResponse.json({ error: 'Amount exceeds the ₦500,000 per-adjustment limit' }, { status: 400 })
  }

  // Rule #28: re-authenticate (fresh login PIN) for any adjustment ≥ ₦50,000.
  const stepUp = await requireStepUpForAmount(session, amountKobo, parsed.data.reauth_pin)
  if (!stepUp.ok) {
    return NextResponse.json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
  }

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }

  const db = createSupabaseAdmin()
  const reference = `ADJ-${crypto.randomUUID()}`

  // Locate the account (vendor → rider → customer) and adjust the right wallet.
  const { data: vendor } = await db.from('vendors').select('id, shop_name').eq('phone', phone).maybeSingle()
  const { data: rider } = vendor ? { data: null } : await db.from('riders').select('id, full_name').eq('phone', phone).maybeSingle()
  const { data: customer } = (vendor || rider) ? { data: null } : await db.from('customers').select('id, name').eq('phone', phone).maybeSingle()

  type AdjResult = { success?: boolean; error?: string; new_balance?: number }
  let result: AdjResult | null = null
  let target: { role: string; name: string } | null = null

  if (vendor) {
    const { data } = await db.rpc('admin_adjust_wallet', { p_user_id: vendor.id, p_user_type: 'VENDOR', p_amount: amountKobo, p_reason: parsed.data.reason, p_by: session.phone, p_reference: reference })
    result = data as unknown as AdjResult
    target = { role: 'vendor', name: String(vendor.shop_name) }
  } else if (rider) {
    const { data } = await db.rpc('admin_adjust_wallet', { p_user_id: rider.id, p_user_type: 'RIDER', p_amount: amountKobo, p_reason: parsed.data.reason, p_by: session.phone, p_reference: reference })
    result = data as unknown as AdjResult
    target = { role: 'rider', name: String(rider.full_name) }
  } else if (customer) {
    const { data } = await db.rpc('admin_adjust_customer_wallet', { p_customer_id: customer.id, p_amount: amountKobo, p_reason: parsed.data.reason, p_reference: reference })
    result = data as unknown as AdjResult
    target = { role: 'customer', name: String(customer.name ?? '—') }
  } else {
    return NextResponse.json({ error: 'No account found for that number' }, { status: 404 })
  }

  if (!result?.success) {
    return NextResponse.json({ error: result?.error ?? 'Adjustment failed' }, { status: 400 })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'wallet_adjusted',
    target_table: 'wallet',
    target_id: phone.slice(-4).padStart(phone.length, '*'),
    new_value: { role: target?.role, amount_kobo: amountKobo, reason: parsed.data.reason, reference, new_balance: result.new_balance },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, role: target?.role, name: target?.name, new_balance_kobo: result.new_balance })
}
