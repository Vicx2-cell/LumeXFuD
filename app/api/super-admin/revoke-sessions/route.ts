import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit, superAudit } from '@/lib/audit'
import { recordSecurityEvent } from '@/lib/security-events'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Re-key everything" — revoke every active session so every issued token
// (including one an attacker stole) dies instantly and everyone must log in
// again. getCurrentUser() already rejects sessions with revoked_at set, so this
// takes effect on the very next request. The super-admin's CURRENT session is
// kept so the operator isn't kicked out mid-incident. Super-admin only.
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`revoke-sessions:${session.userId ?? session.phone}`, 5, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .is('revoked_at', null)
    .neq('id', session.sessionId) // keep the operator signed in
    .select('id')
  if (error) return NextResponse.json({ error: 'Could not revoke sessions' }, { status: 500 })

  const revoked = data?.length ?? 0
  const entry = {
    actor_id: session.phone,
    actor_role: session.role,
    action: 'sessions_revoked_all',
    target_table: 'sessions',
    target_id: 'all',
    new_value: { revoked },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  }
  await audit(entry)
  await superAudit(entry)
  await recordSecurityEvent({
    eventType: 'session_revoked', severity: 'warn', surface: 'jwt',
    actorId: session.userId, actorRole: session.role, sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    detail: { revoked, scope: 'all_except_operator' },
  })

  return NextResponse.json({ revoked })
}
