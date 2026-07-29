import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { pinOfficialPost, unpinOfficialPost } from '@/lib/feed/pins'

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('pin'),
    postId: z.string().uuid(),
    scopeType: z.enum(['global', 'city', 'campus', 'delivery_area']),
    scopeId: z.string().uuid().nullable(),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  }),
  z.object({ action: z.literal('unpin'), pinId: z.string().uuid() }),
])

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createSupabaseAdmin()
  const { data, error } = await db.from('feed_post_pins').select('*').is('unpinned_at', null).order('priority', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pins: data ?? [] })
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const limit = await rateLimitGeneric(`official-feed-pin:${session.userId ?? session.phone}`, 20, 60)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid pin request' }, { status: 400 })
  try {
    const actorId = session.userId ?? session.phone
    const result = parsed.data.action === 'pin'
      ? await pinOfficialPost({ role: session.role, actorId, ...parsed.data })
      : await unpinOfficialPost({ role: session.role, actorId, pinId: parsed.data.pinId })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin action failed' }, { status: 409 })
  }
}
