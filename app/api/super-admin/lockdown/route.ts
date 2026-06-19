import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getControls, invalidateControlsCache, CONTROL_IDS } from '@/lib/controls'
import { audit, superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PANIC lockdown — the "inject security" switch. When ON, every role except
// super_admin is locked out at login, in getCurrentUser (all APIs + server
// components) and in the proxy (all pages). Super-admin only.

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (session.role !== 'super_admin') return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

export async function GET() {
  const { err } = await requireSuperAdmin()
  if (err) return err
  const c = await getControls(true)
  return NextResponse.json({ enabled: c.lockdown_enabled })
}

const schema = z.object({ enabled: z.boolean() }).strict()

export async function POST(req: NextRequest) {
  const { err, session } = await requireSuperAdmin()
  if (err || !session) return err!

  const rl = await rateLimitGeneric(`lockdown:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { error: upErr } = await db.from('settings').upsert(
    { id: CONTROL_IDS.lockdown, value: parsed.data.enabled, updated_by: session.phone, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (upErr) return NextResponse.json({ error: 'Could not update lockdown' }, { status: 500 })

  invalidateControlsCache()

  const entry = {
    actor_id: session.phone,
    actor_role: session.role,
    action: parsed.data.enabled ? 'lockdown_enabled' : 'lockdown_disabled',
    target_table: 'settings',
    target_id: CONTROL_IDS.lockdown,
    new_value: { enabled: parsed.data.enabled },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  }
  await audit(entry)
  await superAudit(entry)

  return NextResponse.json({ enabled: parsed.data.enabled })
}
