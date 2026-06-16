import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getCurrentUser } from '@/lib/session'
import { readAnnouncements, audienceMatches, isVisibleNow } from '@/lib/announcement'

export const dynamic = 'force-dynamic'

// GET /api/announcement — ALL announcements visible to the CURRENT viewer right
// now (multiple can be live at once). Public: a logged-out visitor sees
// ALL-audience messages; logged-in users also see ones targeted at their role.
// Respects each message's scheduled start/expiry window. Returns display fields.
export async function GET() {
  const session = await getCurrentUser().catch(() => null)
  const role = session?.role ?? null

  const all = await readAnnouncements()
  const visible = all
    .filter((a) => isVisibleNow(a) && audienceMatches(a.audience, role))
    .map((a) => ({ id: a.id, title: a.title, message: a.message, level: a.level }))

  // Opaque per-login marker: changes on every new login (new session row), stable
  // within a session. The client resets its "dismissed" set when this changes, so
  // every announcement shows again on each login. Hashed — never the raw id.
  const sid = session?.sessionId
    ? crypto.createHash('sha256').update(session.sessionId).digest('hex').slice(0, 16)
    : null

  return NextResponse.json({ announcements: visible, sid })
}
