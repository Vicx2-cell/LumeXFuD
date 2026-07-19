import { createSupabaseAdmin } from '@/lib/supabase/server'

/** Keep the official account present in every real account's Following feed. */
export async function autoFollowOfficialAccount(profileId: string, db = createSupabaseAdmin()) {
  const { data: official } = await db
    .from('social_profiles')
    .select('id')
    .eq('system_account_key', 'lumex_fud')
    .maybeSingle()
  if (!official?.id || official.id === profileId) return
  await db.from('follows').upsert({
    follower_profile_id: profileId,
    followed_profile_id: official.id,
  }, { onConflict: 'follower_profile_id,followed_profile_id', ignoreDuplicates: true })
}
