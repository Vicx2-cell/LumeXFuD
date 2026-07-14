import type { SessionRole } from '@/lib/session'
import type { createSupabaseAdmin } from '@/lib/supabase/server'

export type FeedPermissionProfile = {
  id: string
  profile_kind: string | null
  is_verified: boolean | null
  is_system_account: boolean | null
  official_badge_kind: string | null
  premium_verified: boolean | null
  premium_label: string | null
  vendor_id: string | null
}

export type FeedPermissionVendor = {
  id: string
  approval_state: string | null
  is_active: boolean | null
  is_verified: boolean | null
  business_verified: boolean | null
  id_verified: boolean | null
}

export type FeedPublisherKind = 'official' | 'verified_vendor' | 'ambassador' | 'student' | 'blocked'

export function isOfficialFeedProfile(profile: FeedPermissionProfile | null | undefined) {
  return Boolean(profile?.is_system_account || profile?.official_badge_kind === 'official')
}

export function isVerifiedFeedVendor(vendor: FeedPermissionVendor | null | undefined) {
  return Boolean(
    vendor
      && vendor.approval_state === 'approved'
      && vendor.is_active !== false
      && (vendor.is_verified || vendor.business_verified || vendor.id_verified),
  )
}

export function isApprovedAmbassadorProfile(profile: FeedPermissionProfile | null | undefined) {
  return Boolean(
    profile?.premium_label
      && /ambassador/i.test(profile.premium_label)
      && (profile.is_verified || profile.premium_verified),
  )
}

export function resolveFeedPublisherKind(
  profile: FeedPermissionProfile | null | undefined,
  vendor: FeedPermissionVendor | null | undefined,
): FeedPublisherKind {
  if (!profile) return 'blocked'
  if (isOfficialFeedProfile(profile)) return 'official'
  if (profile.profile_kind === 'vendor') return isVerifiedFeedVendor(vendor) ? 'verified_vendor' : 'blocked'
  if (isApprovedAmbassadorProfile(profile)) return 'ambassador'
  if (profile.profile_kind === 'customer') return 'student'
  return 'blocked'
}

export function canPublishFeedPost(profile: FeedPermissionProfile | null | undefined, vendor: FeedPermissionVendor | null | undefined) {
  const kind = resolveFeedPublisherKind(profile, vendor)
  return kind === 'official' || kind === 'verified_vendor' || kind === 'ambassador'
}

export function canCreateStory(profile: FeedPermissionProfile | null | undefined, vendor: FeedPermissionVendor | null | undefined) {
  const kind = resolveFeedPublisherKind(profile, vendor)
  return kind !== 'blocked'
}

export function storyStatusForPublisher(profile: FeedPermissionProfile | null | undefined, vendor: FeedPermissionVendor | null | undefined) {
  return resolveFeedPublisherKind(profile, vendor) === 'student' ? 'under_review' : 'published'
}

export function canModerateStories(role: SessionRole) {
  return role === 'admin' || role === 'super_admin'
}

export async function loadFeedPermissionContext(
  db: ReturnType<typeof createSupabaseAdmin>,
  profileId: string,
) {
  const { data: profile } = await db
    .from('social_profiles')
    .select('id, profile_kind, is_verified, is_system_account, official_badge_kind, premium_verified, premium_label, vendor_id')
    .eq('id', profileId)
    .maybeSingle()

  const typedProfile = (profile ?? null) as FeedPermissionProfile | null
  const { data: vendor } = typedProfile?.vendor_id
    ? await db
        .from('vendors')
        .select('id, approval_state, is_active, is_verified, business_verified, id_verified')
        .eq('id', typedProfile.vendor_id)
        .maybeSingle()
    : { data: null }

  return {
    profile: typedProfile,
    vendor: (vendor ?? null) as FeedPermissionVendor | null,
  }
}
