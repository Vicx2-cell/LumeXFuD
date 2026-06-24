import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { roleToUserType } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

const SubSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
}).strict()

// POST /api/push/subscribe — store (or refresh) a Web Push subscription for the
// current user/device. Endpoint is UNIQUE: a re-subscribe upserts so we never
// pile up dead rows for the same device.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = SubSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { error } = await db
    .from('push_subscriptions')
    .upsert({
      user_id: user.userId,
      user_type: roleToUserType(user.role),
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: req.headers.get('user-agent')?.slice(0, 256) ?? null,
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })

  if (error) {
    console.error('[push/subscribe] upsert error:', error.message)
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE /api/push/subscribe — remove a subscription (user turned push off / on
// PWA uninstall the browser drops it). Body: { endpoint }.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: { endpoint?: unknown } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (typeof body.endpoint !== 'string') return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

  const db = createSupabaseAdmin()
  // Scope the delete to the owner so an endpoint string can't nuke another user's row.
  await db.from('push_subscriptions').delete().eq('endpoint', body.endpoint).eq('user_id', user.userId)
  return NextResponse.json({ ok: true })
}
