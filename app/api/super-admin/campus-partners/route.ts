import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { superAudit } from '@/lib/audit'
import { createCampusPayout, campusPartnerLink } from '@/lib/campus-partners'

const actionSchema = z.object({
  action: z.enum(['approve', 'suspend', 'revoke', 'dispute', 'payout']),
  partner_id: z.string().uuid(),
  application_id: z.string().uuid().optional(),
  campus_id: z.string().uuid().nullable().optional(),
  territory: z.string().trim().max(200).nullable().optional(),
  commission_rate: z.number().min(0).max(1).optional(),
  target_monthly_orders: z.number().int().min(0).optional(),
  amount_kobo: z.number().int().min(0).optional(),
  reason: z.string().trim().max(500).optional(),
  idempotency_key: z.string().trim().max(200).optional(),
})

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const auth = await requireSuperAdmin()
  if ('error' in auth) return auth.error
  const db = createSupabaseAdmin()
  const { data } = await db.from('campus_partners').select('*').order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ ok: true, partners: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if ('error' in auth) return auth.error
  const rl = await rateLimitGeneric(`super-campus-partners:${auth.session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const db = createSupabaseAdmin()
  const partner = await db.from('campus_partners').select('*').eq('id', parsed.data.partner_id).maybeSingle()
  const application = parsed.data.application_id
    ? await db.from('campus_partner_applications').select('*').eq('id', parsed.data.application_id).maybeSingle()
    : null
  if (!partner.data && !application?.data) return NextResponse.json({ error: 'Campus partner not found' }, { status: 404 })

  const now = new Date().toISOString()
  const current = (partner.data ?? application?.data ?? {}) as Record<string, unknown>
  const update: Record<string, unknown> = { updated_at: now }

  if (parsed.data.action === 'approve') {
    const referralCode = String(current.referral_code ?? `CP${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`)
    update.status = 'active'
    update.approved_at = now
    update.approved_by = auth.session.phone
    update.suspended_at = null
    update.suspended_reason = null
    if (typeof parsed.data.commission_rate === 'number') update.commission_rate = parsed.data.commission_rate
    if (typeof parsed.data.target_monthly_orders === 'number') update.target_monthly_orders = parsed.data.target_monthly_orders
    if (parsed.data.campus_id !== undefined) update.campus_id = parsed.data.campus_id
    if (parsed.data.territory !== undefined) update.territory = parsed.data.territory
    update.referral_code = referralCode
    update.referral_link = campusPartnerLink(referralCode)
    if (!partner.data) {
      const { error: insertError } = await db.from('campus_partners').insert({
        id: parsed.data.partner_id,
        application_id: parsed.data.application_id ?? null,
        profile_id: String(current.profile_id ?? parsed.data.partner_id),
        owner_role: String(current.owner_role ?? 'campus_partner'),
        campus_id: parsed.data.campus_id ?? current.campus_id ?? null,
        territory: parsed.data.territory ?? current.territory ?? null,
        referral_code: referralCode,
        referral_link: campusPartnerLink(referralCode),
        commission_rate: typeof parsed.data.commission_rate === 'number' ? parsed.data.commission_rate : Number(current.commission_rate ?? 0),
        target_monthly_orders: typeof parsed.data.target_monthly_orders === 'number' ? parsed.data.target_monthly_orders : Number(current.target_monthly_orders ?? 0),
        approved_at: now,
        approved_by: auth.session.phone,
        status: 'active',
        metadata: {},
      })
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 })
    }
  }

  if (parsed.data.action === 'suspend') {
    update.status = 'suspended'
    update.suspended_at = now
    update.suspended_reason = parsed.data.reason ?? 'Suspended by admin'
  }

  if (parsed.data.action === 'revoke') {
    update.status = 'revoked'
    update.suspended_at = now
    update.suspended_reason = parsed.data.reason ?? 'Revoked by admin'
  }

  if (parsed.data.action === 'dispute') {
    update.status = 'disputed'
    update.suspended_reason = parsed.data.reason ?? 'Marked disputed by admin'
  }

  if (parsed.data.action === 'payout') {
    const amount = parsed.data.amount_kobo ?? 0
    const idempotencyKey = parsed.data.idempotency_key ?? `campus-payout:${parsed.data.partner_id}:${amount}:${parsed.data.reason ?? 'default'}`
    const payout = await createCampusPayout(parsed.data.partner_id, amount, auth.session.phone, idempotencyKey)
    await superAudit({
      actor_id: auth.session.phone,
      actor_role: auth.session.role,
      action: 'campus_partner_payout',
      target_table: 'campus_partner_payouts',
      target_id: payout.reference,
      old_value: current,
      new_value: { amount_kobo: amount, payout_reference: payout.reference, idempotency_key: idempotencyKey },
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return NextResponse.json({ ok: true, payout_reference: payout.reference })
  }

  const { error } = await db.from('campus_partners').update(update).eq('id', parsed.data.partner_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (parsed.data.application_id) {
    const applicationStatus = parsed.data.action === 'approve'
      ? 'approved'
      : parsed.data.action === 'dispute'
        ? 'disputed'
        : parsed.data.action === 'suspend'
          ? 'suspended'
          : 'rejected'
    await db.from('campus_partner_applications').update({ status: applicationStatus, reviewed_by: auth.session.phone, reviewed_at: now, admin_notes: parsed.data.reason ?? null, updated_at: now }).eq('id', parsed.data.application_id)
  }

  await superAudit({
    actor_id: auth.session.phone,
    actor_role: auth.session.role,
    action: `campus_partner_${parsed.data.action}`,
    target_table: 'campus_partners',
    target_id: parsed.data.partner_id,
    old_value: current,
    new_value: update,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ ok: true })
}
