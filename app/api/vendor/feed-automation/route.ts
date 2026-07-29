import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), optionalMarketingEnabled: z.boolean(), disabledPostTypes: z.array(z.string().max(80)).max(20).optional() }),
  z.object({ action: z.literal('archive'), postId: z.string().uuid() }),
])

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor' || !session.userId) return NextResponse.json({ error: 'Vendor only' }, { status: 403 })
  const db = createSupabaseAdmin()
  const [settings, posts] = await Promise.all([
    db.from('vendor_feed_automation_settings').select('*').eq('vendor_id', session.userId).maybeSingle(),
    db.from('posts').select('id, body, automatic_post_type, generated_at, status, archived_at, source_event_type, source_entity_id, template_version').eq('vendor_id', session.userId).eq('generation_mode', 'automatic').order('generated_at', { ascending: false }).limit(100),
  ])
  return NextResponse.json({
    settings: settings.data ?? { optional_marketing_enabled: true, automation_paused: false, disabled_post_types: [] },
    posts: posts.data ?? [],
  })
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor' || !session.userId) return NextResponse.json({ error: 'Vendor only' }, { status: 403 })
  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const db = createSupabaseAdmin()
  if (parsed.data.action === 'settings') {
    const { error } = await db.from('vendor_feed_automation_settings').upsert({
      vendor_id: session.userId,
      optional_marketing_enabled: parsed.data.optionalMarketingEnabled,
      disabled_post_types: parsed.data.disabledPostTypes ?? [],
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    }, { onConflict: 'vendor_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  const now = new Date().toISOString()
  const { data, error } = await db.from('posts').update({
    status: 'archived', is_archived: true, archived_at: now,
    archived_reason: 'archived by vendor', cta_enabled: false, updated_at: now,
  }).eq('id', parsed.data.postId).eq('vendor_id', session.userId).eq('generation_mode', 'automatic').select('id').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Generated post not found' }, { status: 404 })
  await db.from('feed_generation_audit').insert({ post_id: parsed.data.postId, action: 'archived', reason: 'vendor archived eligible generated post', actor_type: 'vendor', actor_id: session.userId })
  return NextResponse.json({ ok: true })
}
