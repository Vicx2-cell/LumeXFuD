import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { getCurrentUser } from '@/lib/session'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { readAnnouncements, writeAnnouncements, isLongExpired, type Announcement } from '@/lib/announcement'

export const runtime = 'nodejs'

const MAX_ANNOUNCEMENTS = 20

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { error: null, session }
}

// GET — every stored announcement (live, scheduled, ended) for management.
export async function GET() {
  const { error, session } = await requireSuperAdmin()
  if (error) return error
  void session
  return NextResponse.json({ announcements: await readAnnouncements() })
}

const postInput = z.object({
  message:  z.string().trim().min(1).max(500),
  title:    z.string().trim().max(80).optional(),
  audience: z.enum(['ALL', 'CUSTOMER', 'VENDOR', 'RIDER']),
  level:    z.enum(['info', 'warning', 'success']),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  expires_at:   z.string().datetime({ offset: true }).nullable().optional(),
})

// POST — ADD a new announcement (does NOT replace existing ones).
export async function POST(req: NextRequest) {
  const { error, session } = await requireSuperAdmin()
  if (error || !session) return error!

  const rl = await rateLimitGeneric(`super-announce:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = postInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  const scheduledAt = parsed.data.scheduled_at ?? null
  const expiresAt   = parsed.data.expires_at ?? null
  if (scheduledAt && expiresAt && new Date(expiresAt).getTime() <= new Date(scheduledAt).getTime()) {
    return NextResponse.json({ error: 'Auto-hide time must be after the show time' }, { status: 400 })
  }

  const announcement: Announcement = {
    id:           crypto.randomUUID(),
    title:        parsed.data.title && parsed.data.title.length > 0 ? parsed.data.title : null,
    message:      parsed.data.message,
    audience:     parsed.data.audience,
    level:        parsed.data.level,
    scheduled_at: scheduledAt,
    expires_at:   expiresAt,
    created_at:   new Date().toISOString(),
    created_by:   session.phone,
  }

  // Append; drop ones that expired long ago; cap the list.
  const current = (await readAnnouncements()).filter((a) => !isLongExpired(a))
  const next = [announcement, ...current].slice(0, MAX_ANNOUNCEMENTS)
  const ok = await writeAnnouncements(next, session.phone)
  if (!ok) return NextResponse.json({ error: 'Failed to publish' }, { status: 500 })

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'announcement_published',
    target_table: 'settings',
    target_id: announcement.id,
    new_value: { audience: announcement.audience, level: announcement.level, message: announcement.message, scheduled_at: scheduledAt, expires_at: expiresAt },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, announcement })
}

// DELETE ?id=… — clear ONE announcement (the others stay live).
export async function DELETE(req: NextRequest) {
  const { error, session } = await requireSuperAdmin()
  if (error || !session) return error!

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const current = await readAnnouncements()
  const removed = current.find((a) => a.id === id)
  const next = current.filter((a) => a.id !== id)
  const ok = await writeAnnouncements(next, session.phone)
  if (!ok) return NextResponse.json({ error: 'Failed to clear' }, { status: 500 })

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'announcement_cleared',
    target_table: 'settings',
    target_id: id,
    old_value: removed ? { message: removed.message, audience: removed.audience } : undefined,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
