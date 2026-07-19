import crypto from 'node:crypto'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'

export type ReferralRole = 'customer' | 'vendor' | 'rider' | 'campus_partner'
export type ReferralRewardStatus = 'pending' | 'approved' | 'reversed' | 'manual_review'

export interface ReferralHistoryItem {
  id: string
  status: 'pending' | 'approved' | 'reversed' | 'blocked'
  reward_state: 'pending' | 'approved' | 'reversed' | 'blocked' | 'manual_review'
  referred_role: ReferralRole
  reward_referrer_kobo: number
  reward_referred_kobo: number
  approved_at: string | null
  reversed_at: string | null
  reversal_reason: string | null
  created_at: string
}

export interface ReferralHubSummary {
  role: ReferralRole
  code: string
  link: string
  referred_count: number
  approved_count: number
  pending_count: number
  reversed_count: number
  limits: {
    daily: number
    monthly: number
    device: number
  }
  reward_referrer_kobo: number
  reward_referred_kobo: number
  history: ReferralHistoryItem[]
}

function randomCode(length = 8) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

export function referralLinkForRole(role: ReferralRole, code: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const route = role === 'vendor'
    ? '/apply/vendor'
    : role === 'rider'
      ? '/apply/rider'
      : role === 'campus_partner'
        ? '/campus-partners'
        : '/auth/register'
  return `${base}${route}?ref=${encodeURIComponent(code)}`
}

export async function ensureReferralCodeForRole(profileId: string, role: ReferralRole) {
  const db = createSupabaseAdmin()
  const { data: existing } = await db.from('referral_codes').select('code').eq('owner_profile_id', profileId).eq('owner_role', role).maybeSingle()
  if (existing?.code) return String(existing.code)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode()
    const { error } = await db.from('referral_codes').insert({
      owner_profile_id: profileId,
      owner_role: role,
      code_kind: role,
      code,
      created_by: 'system',
      metadata: { role },
    })
    if (!error) return code
    const { data: recheck } = await db.from('referral_codes').select('code').eq('owner_profile_id', profileId).eq('owner_role', role).maybeSingle()
    if (recheck?.code) return String(recheck.code)
  }

  throw new Error('Could not allocate referral code')
}

export async function getReferralHubSummary(profileId: string, role: ReferralRole): Promise<ReferralHubSummary> {
  const db = createSupabaseAdmin()
  const code = await ensureReferralCodeForRole(profileId, role)
  const [{ data: rows }, { count: referredCount }] = await Promise.all([
    db
      .from('referrals')
      .select('id, status, reward_state, referred_role, first_reward_at, second_reward_at, approved_at, reversed_at, reversal_reason, created_at, reward_referrer_kobo, reward_referred_kobo', { count: 'exact' })
      .eq('referrer_id', profileId)
      .order('created_at', { ascending: false })
      .limit(50),
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', profileId),
  ])

  const history = (rows ?? []).map((row) => {
    const item = row as Record<string, unknown>
    return {
      id: String(item.id),
      status: (item.status as ReferralHistoryItem['status']) ?? 'pending',
      reward_state: (item.reward_state as ReferralHistoryItem['reward_state']) ?? 'pending',
      referred_role: (item.referred_role as ReferralRole) ?? 'customer',
      reward_referrer_kobo: Number(item.reward_referrer_kobo ?? 0),
      reward_referred_kobo: Number(item.reward_referred_kobo ?? 0),
      approved_at: typeof item.approved_at === 'string' ? item.approved_at : null,
      reversed_at: typeof item.reversed_at === 'string' ? item.reversed_at : null,
      reversal_reason: typeof item.reversal_reason === 'string' ? item.reversal_reason : null,
      created_at: String(item.created_at ?? new Date().toISOString()),
    } satisfies ReferralHistoryItem
  })

  const approvedCount = history.filter((item) => item.reward_state === 'approved' || item.status === 'approved').length
  const pendingCount = history.filter((item) => item.reward_state === 'pending' || item.status === 'pending').length
  const reversedCount = history.filter((item) => item.reward_state === 'reversed' || item.status === 'reversed').length

  return {
    role,
    code,
    link: referralLinkForRole(role, code),
    referred_count: referredCount ?? history.length,
    approved_count: approvedCount,
    pending_count: pendingCount,
    reversed_count: reversedCount,
    limits: { daily: 10, monthly: 120, device: 2 },
    reward_referrer_kobo: role === 'campus_partner' ? 0 : 30000,
    reward_referred_kobo: role === 'campus_partner' ? 0 : 20000,
    history,
  }
}

export async function currentReferralHub() {
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
  const { data: profile } = await db.from('social_profiles').select('id, profile_kind').eq(roleColumn, session.userId).maybeSingle()
  if (!profile?.id) return null
  const role = ((session.role === 'admin' || session.role === 'super_admin') ? 'customer' : session.role) as ReferralRole
  return getReferralHubSummary(String(profile.id), role)
}
