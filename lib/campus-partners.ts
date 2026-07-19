import crypto from 'node:crypto'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'

export interface CampusPartnerApplicationInput {
  full_name: string
  phone: string
  campus_id?: string | null
  territory?: string | null
  application_text?: string | null
  target_monthly_orders?: number
  proposed_commission_rate?: number
}

export interface CampusPartnerSummary {
  id: string
  profile_id: string
  campus_id: string | null
  territory: string | null
  referral_code: string
  referral_link: string
  commission_rate: number
  target_monthly_orders: number
  status: 'active' | 'suspended' | 'disputed' | 'revoked'
  earnings_kobo: number
  paid_kobo: number
  pending_kobo: number
  payouts: Array<{
    id: string
    payout_reference: string
    amount_kobo: number
    status: string
    created_at: string
  }>
  leaderboard_rank: number | null
}

function randomReference() {
  return `CP-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

export function campusPartnerLink(code: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  return `${base}/campus-partners?ref=${encodeURIComponent(code)}`
}

export async function getCurrentCampusPartnerProfile() {
  const session = await getCurrentUser()
  if (!session?.userId) return null
  const db = createSupabaseAdmin()
  const roleColumn = session.role === 'customer'
    ? 'customer_id'
    : session.role === 'vendor'
      ? 'vendor_id'
      : session.role === 'rider'
        ? 'rider_id'
        : 'admin_id'
  const { data: profile } = await db.from('social_profiles').select('id').eq(roleColumn, session.userId).maybeSingle()
  if (!profile?.id) return null
  return { session, profileId: String(profile.id) }
}

export async function submitCampusPartnerApplication(input: CampusPartnerApplicationInput) {
  const db = createSupabaseAdmin()
  const profile = await getCurrentCampusPartnerProfile()
  if (!profile?.profileId) throw new Error('Could not resolve profile')
  const ownerRole = profile.session.role === 'customer' || profile.session.role === 'vendor' || profile.session.role === 'rider'
    ? profile.session.role
    : 'customer'

  const { data: existing } = await db.from('campus_partner_applications').select('id, status').eq('profile_id', profile.profileId).maybeSingle()
  if (existing?.id && existing.status === 'approved') {
    return { applicationId: String(existing.id), status: 'approved' as const }
  }

  const { data, error } = await db.from('campus_partner_applications').upsert({
    profile_id: profile.profileId,
    owner_role: ownerRole,
    full_name: input.full_name.trim(),
    phone: input.phone.trim(),
    campus_id: input.campus_id ?? null,
    territory: input.territory ?? null,
    application_text: input.application_text ?? null,
    target_monthly_orders: Math.max(0, Math.round(input.target_monthly_orders ?? 0)),
    proposed_commission_rate: Math.max(0, Math.min(1, Number(input.proposed_commission_rate ?? 0))),
    status: existing?.status === 'approved' ? 'approved' : 'pending',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' }).select('id, status').maybeSingle()
  if (error) throw new Error(error.message)
  return { applicationId: String(data?.id ?? existing?.id ?? ''), status: String(data?.status ?? 'pending') }
}

export async function loadCampusPartnerSummary(profileId: string): Promise<CampusPartnerSummary | null> {
  const db = createSupabaseAdmin()
  const [{ data: partner }, ] = await Promise.all([
    db.from('campus_partners').select('id, profile_id, campus_id, territory, referral_code, referral_link, commission_rate, target_monthly_orders, status').eq('profile_id', profileId).maybeSingle(),
  ])

  if (!partner) return null
  const partnerId = String((partner as { id: string }).id)
  const [earnings, payouts] = await Promise.all([
    db.from('campus_partner_earnings').select('amount_kobo, status').eq('campus_partner_id', partnerId),
    db.from('campus_partner_payouts').select('id, payout_reference, amount_kobo, status, created_at').eq('campus_partner_id', partnerId).order('created_at', { ascending: false }).limit(10),
  ])
  const earningsRows = ((earnings ?? []) as unknown) as Array<{ amount_kobo: number; status: string }>
  const payoutsRows = ((payouts ?? []) as unknown) as Array<{ id: string; payout_reference: string; amount_kobo: number; status: string; created_at: string }>
  const total = earningsRows.reduce((sum, row) => sum + Number(row.amount_kobo ?? 0), 0)
  const pending = earningsRows.filter((row) => row.status === 'pending').reduce((sum, row) => sum + Number(row.amount_kobo ?? 0), 0)
  const paid = earningsRows.filter((row) => row.status === 'paid' || row.status === 'approved').reduce((sum, row) => sum + Number(row.amount_kobo ?? 0), 0)
  return {
    id: partnerId,
    profile_id: String((partner as { profile_id: string }).profile_id),
    campus_id: partner.campus_id ?? null,
    territory: partner.territory ?? null,
    referral_code: String(partner.referral_code),
    referral_link: String(partner.referral_link),
    commission_rate: Number(partner.commission_rate ?? 0),
    target_monthly_orders: Number(partner.target_monthly_orders ?? 0),
    status: partner.status as CampusPartnerSummary['status'],
    earnings_kobo: total,
    paid_kobo: paid,
    pending_kobo: pending,
    payouts: payoutsRows,
    leaderboard_rank: null,
  }
}

export async function createCampusPayout(campusPartnerId: string, amountKobo: number, actor: string, idempotencyKey?: string) {
  const db = createSupabaseAdmin()
  const normalizedAmount = Math.max(0, Math.round(amountKobo))
  const key = idempotencyKey ?? `campus-payout:${campusPartnerId}:${normalizedAmount}:${actor}`
  const { data: existingByKey } = await db
    .from('campus_partner_payouts')
    .select('payout_reference, amount_kobo, status')
    .eq('idempotency_key', key)
    .maybeSingle()
  if (existingByKey?.payout_reference) {
    return { reference: String(existingByKey.payout_reference) }
  }
  const { data: existing } = await db
    .from('campus_partner_payouts')
    .select('payout_reference, amount_kobo, status')
    .eq('campus_partner_id', campusPartnerId)
    .eq('amount_kobo', normalizedAmount)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing?.payout_reference) {
    return { reference: String(existing.payout_reference) }
  }
  const reference = randomReference()
  const { error } = await db.from('campus_partner_payouts').insert({
    campus_partner_id: campusPartnerId,
    payout_reference: reference,
    amount_kobo: normalizedAmount,
    status: 'pending',
    payout_method: 'bank_transfer',
    approved_by: actor,
    idempotency_key: key,
    metadata: { actor },
  })
  if (error) throw new Error(error.message)
  return { reference }
}
