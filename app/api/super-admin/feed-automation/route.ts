import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { renderOfficialCollection, renderVendorAutomaticPost } from '@/lib/feed/automation'
import { loadFeedAutomationConfig } from '@/lib/feed/automation-service'

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  vendorDailyLimit: z.number().int().min(0).max(20).optional(),
  officialAreaWindowLimit: z.number().int().min(0).max(20).optional(),
  duplicateTopicCooldownHours: z.number().int().min(1).max(2160).optional(),
  menuBatchWindowMinutes: z.number().int().min(1).max(1440).optional(),
  vendorReopenMinimumHours: z.number().int().min(1).max(2160).optional(),
  priceDropMinimumBps: z.number().int().min(1).max(10000).optional(),
  priceDropMinimumKobo: z.number().int().min(0).optional(),
  backInStockMinimumOrders: z.number().int().min(0).optional(),
  popularityMinimumOrders: z.number().int().min(2).optional(),
  anonymityMinimumOrders: z.number().int().min(2).optional(),
  orderAggregationHours: z.number().int().min(1).max(720).optional(),
  affordabilityMaxItemKobo: z.number().int().min(0).optional(),
  affordabilityMaxMealKobo: z.number().int().min(0).optional(),
  collectionItemCount: z.number().int().min(3).max(10).optional(),
  enabledPostTypes: z.record(z.string(), z.boolean()).optional(),
  milestoneValues: z.array(z.number().int().positive()).max(20).optional(),
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry_job'), jobId: z.string().uuid() }),
  z.object({ action: z.literal('archive_post'), postId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }),
])

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error
  const db = createSupabaseAdmin()
  const [config, jobs, audit] = await Promise.all([
    loadFeedAutomationConfig(db),
    db.from('feed_automation_outbox').select('*').in('status', ['retry', 'dead']).order('updated_at', { ascending: false }).limit(100),
    db.from('feed_generation_audit').select('*').order('created_at', { ascending: false }).limit(100),
  ])
  const previewFacts = {
    vendorId: 'preview', vendorName: 'Mama Chika’s Kitchen', vendorApproved: true,
    vendorActive: true, storefrontComplete: true, availableMenuItemCount: 1,
    itemId: 'preview-item', itemName: 'Chicken Fried Rice', itemPriceKobo: 250000, itemAvailable: true,
  }
  return NextResponse.json({
    config: { ...config, enabledPostTypes: [...config.enabledPostTypes] },
    failedJobs: jobs.data ?? [],
    audit: audit.data ?? [],
    templatePreviews: {
      vendor: renderVendorAutomaticPost('new_menu_item', previewFacts),
      official: renderOfficialCollection('cheap_eats', 'Uturu', 5, config.affordabilityMaxMealKobo),
    },
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error
  const limit = await rateLimitGeneric(`feed-automation-settings:${gate.session.userId ?? gate.session.phone}`, 20, 60)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const parsed = settingsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid feed automation settings' }, { status: 400 })
  const value = parsed.data
  const update = {
    enabled: value.enabled,
    vendor_daily_limit: value.vendorDailyLimit,
    official_area_window_limit: value.officialAreaWindowLimit,
    duplicate_topic_cooldown_hours: value.duplicateTopicCooldownHours,
    menu_batch_window_minutes: value.menuBatchWindowMinutes,
    vendor_reopen_minimum_hours: value.vendorReopenMinimumHours,
    price_drop_minimum_bps: value.priceDropMinimumBps,
    price_drop_minimum_kobo: value.priceDropMinimumKobo,
    back_in_stock_minimum_orders: value.backInStockMinimumOrders,
    popularity_minimum_orders: value.popularityMinimumOrders,
    anonymity_minimum_orders: value.anonymityMinimumOrders,
    order_aggregation_hours: value.orderAggregationHours,
    affordability_max_item_kobo: value.affordabilityMaxItemKobo,
    affordability_max_meal_kobo: value.affordabilityMaxMealKobo,
    collection_item_count: value.collectionItemCount,
    enabled_post_types: value.enabledPostTypes,
    milestone_values: value.milestoneValues,
    updated_by: gate.session.userId ?? gate.session.phone,
    updated_at: new Date().toISOString(),
  }
  const clean = Object.fromEntries(Object.entries(update).filter(([, entry]) => entry !== undefined))
  const db = createSupabaseAdmin()
  const { error } = await db.from('feed_automation_settings').update(clean).eq('id', 'global')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error
  const parsed = actionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  const db = createSupabaseAdmin()
  const actor = gate.session.userId ?? gate.session.phone
  if (parsed.data.action === 'retry_job') {
    const { data, error } = await db.from('feed_automation_outbox').update({
      status: 'pending', available_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
    }).eq('id', parsed.data.jobId).in('status', ['retry', 'dead', 'suppressed']).select('id').maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Job is not rerunnable' }, { status: 409 })
    await db.from('feed_generation_audit').insert({ outbox_id: parsed.data.jobId, action: 'regenerated', reason: 'super-admin requested idempotent rerun', actor_type: 'super_admin', actor_id: actor })
    return NextResponse.json({ ok: true, jobId: parsed.data.jobId })
  }
  const now = new Date().toISOString()
  const { data, error } = await db.from('posts').update({
    status: 'archived', is_archived: true, archived_at: now, archived_reason: parsed.data.reason,
    cta_enabled: false, is_pinned: false, updated_at: now,
  }).eq('id', parsed.data.postId).eq('generation_mode', 'automatic').select('id').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Generated post not found' }, { status: 404 })
  await db.from('feed_post_pins').update({ unpinned_at: now, unpinned_by: actor }).eq('post_id', parsed.data.postId).is('unpinned_at', null)
  await db.from('feed_generation_audit').insert({ post_id: parsed.data.postId, action: 'archived', reason: parsed.data.reason, actor_type: 'super_admin', actor_id: actor })
  return NextResponse.json({ ok: true, postId: parsed.data.postId })
}
