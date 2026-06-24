import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { listInApp, unreadCount, markRead } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// GET /api/notifications — the bell list + unread badge count for the current
// user. Auth (and the PANIC lockdown) is enforced by getCurrentUser; rows are
// scoped to the session's own userId so no one can read another user's inbox.
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const [notifications, unread] = await Promise.all([
    listInApp(user.userId, 30),
    unreadCount(user.userId),
  ])
  return NextResponse.json({ notifications, unread })
}

// PATCH /api/notifications — mark notifications read.
// Body: { all: true } to clear everything, or { ids: string[] } for specific rows.
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: { ids?: unknown; all?: unknown } = {}
  try { body = await req.json() } catch { /* empty body = mark all */ }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 100)
    : undefined

  await markRead(user.userId, body.all === true ? undefined : ids)
  const unread = await unreadCount(user.userId)
  return NextResponse.json({ ok: true, unread })
}
