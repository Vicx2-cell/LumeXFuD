import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { feedComposerActionInput } from '@/lib/feed/validators'
import { createOrSaveFeedPost } from '@/lib/feed/posts'
import { createOfficialEventCollection, getOfficialAreaSettingByScope } from '@/lib/feed/official-scheduler'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notifyInApp } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/push'

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getFeature('feed_enabled')) || !(await getFeature('feed_posting_enabled'))) {
    return NextResponse.json({ error: 'Feed posting is disabled' }, { status: 503 })
  }

  const rl = await rateLimitGeneric(`feed-post:${session.userId ?? session.phone}`, 20, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let parsed
  try {
    parsed = feedComposerActionInput.parse(await req.json())
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await createOrSaveFeedPost(session, parsed, 'publish')
    void (async () => {
      try {
        if (parsed.post_kind === 'PROMOTION' || parsed.post_kind === 'TIKTOK') return
        const db = createSupabaseAdmin()
        const { data: authorProfile } = await db.from('social_profiles').select('id, display_name').eq('id', result.authorProfileId).maybeSingle()
        if (!authorProfile?.id) return
        const { data: followerRows } = await db
          .from('follows')
          .select('follower_profile_id')
          .eq('followed_profile_id', authorProfile.id)
          .limit(20)
        const followerProfileIds = (followerRows ?? []).map((row) => String((row as { follower_profile_id: string }).follower_profile_id))
        if (followerProfileIds.length === 0) return
        const { data: profiles } = await db
          .from('social_profiles')
          .select('id, customer_id, vendor_id, rider_id, admin_id')
          .in('id', followerProfileIds)
        for (const profile of profiles ?? []) {
          const row = profile as { customer_id?: string | null; vendor_id?: string | null; rider_id?: string | null; admin_id?: string | null }
          const userId = row.customer_id ?? row.vendor_id ?? row.rider_id ?? row.admin_id ?? null
          if (!userId) continue
          const userType = row.vendor_id ? 'VENDOR' : row.rider_id ? 'RIDER' : row.admin_id ? 'ADMIN' : 'CUSTOMER'
          const title = `${authorProfile.display_name ?? 'A profile'} posted an update`
          const body = parsed.body?.slice(0, 120) || 'A new meal or vendor update is live in your feed.'
          await notifyInApp({ userId, userType, title, body, link: '/feed' })
          void sendPushToUser(userId, { title, body, url: '/feed', tag: `feed-post-${result.postId}` }).catch(() => {})
        }
      } catch (error) {
        console.error('[feed/posts] follower notification failed:', error instanceof Error ? error.message : error)
      }
    })()
    const promotion = parsed.post_kind === 'PROMOTION' ? parsed.promotion : undefined
    if (promotion) {
      void (async () => {
        try {
          const db = createSupabaseAdmin()
          const { data: vendor } = await db.from('vendors').select('id, shop_name, city_id, zone_id, approval_state, is_active, avg_rating, total_ratings').eq('id', session.userId ?? '').maybeSingle()
          if (vendor && vendor.approval_state === 'approved' && vendor.is_active) {
            const areaScope = vendor.zone_id ? 'zone' : 'city'
            const areaId = String(vendor.zone_id ?? vendor.city_id ?? '')
            if (areaId) {
              const area = await getOfficialAreaSettingByScope(db, areaScope, areaId)
              if (area) {
                await createOfficialEventCollection({
                  area,
                  collectionType: 'new_on_lumex',
                  reason: 'New valid deal published by an approved vendor.',
                  sourceId: `promotion:${result.postId}`,
                  source: [{
                    id: result.postId,
                    vendorId: String(vendor.id),
                    vendorName: String(vendor.shop_name ?? 'Vendor'),
                    itemName: promotion.title,
                    priceKobo: promotion.campaign_price_kobo,
                    imageUrl: parsed.media?.find((m) => m.public_url)?.public_url ?? null,
                    imageBelongsToItem: Boolean(parsed.media?.find((m) => m.public_url)?.public_url),
                    isAvailable: true,
                    vendorApproved: true,
                    vendorActive: true,
                    vendorVisible: true,
                    servesArea: true,
                    areaScope,
                    areaId,
                    sourceType: 'deal',
                    sourceId: result.postId,
                    popularityOrders30d: Number(vendor.total_ratings ?? 0),
                    totalRatings: Number(vendor.total_ratings ?? 0),
                    avgRating: Number(vendor.avg_rating ?? 0),
                  } as never],
                  publish: !!area?.autoPublish,
                })
              }
            }
          }
        } catch (error) {
          console.error('[official-feed] promotion.created failed:', error instanceof Error ? error.message : error)
        }
      })()
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not publish post' }, { status: 400 })
  }
}
