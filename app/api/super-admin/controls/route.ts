import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getControls, invalidateControlsCache, CONTROL_IDS } from '@/lib/controls'

export const runtime = 'nodejs'

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (session.role !== 'super_admin') return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

export async function GET() {
  const { err } = await requireSuperAdmin()
  if (err) return err

  // Last 20 control changes for the on-page audit strip (who flipped what, when).
  const db = createSupabaseAdmin()
  const { data: recentRaw } = await db
    .from('super_audit_logs')
    .select('actor_id, new_value, created_at')
    .eq('action', 'controls_updated')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ controls: await getControls(true), recent: recentRaw ?? [] })
}

const patchInput = z.object({
  withdrawals_frozen:    z.boolean().optional(),
  payouts_mode:          z.enum(['auto', 'manual', 'frozen']).optional(),
  maintenance_enabled:   z.boolean().optional(),
  maintenance_message:   z.string().trim().max(300).optional(),
  notifications_paused:  z.boolean().optional(),
  support_phone:         z.string().trim().max(40).optional(),
  hours_open:            z.string().regex(/^\d{2}:\d{2}$/).optional(),
  hours_close:           z.string().regex(/^\d{2}:\d{2}$/).optional(),
  enforce_hours:         z.boolean().optional(),
  auto_cancel_minutes:   z.number().int().min(0).max(120).optional(),
  ai_provider:           z.enum(['anthropic', 'gemini']).optional(),
})

export async function PATCH(req: NextRequest) {
  const { err, session } = await requireSuperAdmin()
  if (err || !session) return err!

  const rl = await rateLimitGeneric(`super-controls:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  // Merge the provided fields over current state, then write the affected rows.
  const cur = await getControls(true)
  const next = { ...cur, ...parsed.data }
  const now = new Date().toISOString()

  const db = createSupabaseAdmin()
  const rows = [
    { id: CONTROL_IDS.withdrawals,   value: next.withdrawals_frozen,                                              updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.payouts,       value: next.payouts_mode,                                                    updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.maintenance,   value: { enabled: next.maintenance_enabled, message: next.maintenance_message }, updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.notifications, value: next.notifications_paused,                                            updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.support,       value: { phone: next.support_phone },                                        updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.hours,         value: { open: next.hours_open, close: next.hours_close, enforce: next.enforce_hours }, updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.autocancel,    value: { minutes: next.auto_cancel_minutes },                                updated_by: session.phone, updated_at: now },
    { id: CONTROL_IDS.aiProvider,    value: { provider: next.ai_provider },                                       updated_by: session.phone, updated_at: now },
  ]
  const { error } = await db.from('settings').upsert(rows, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })

  invalidateControlsCache()

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'controls_updated',
    target_table: 'settings',
    target_id: 'platform_controls',
    new_value: parsed.data as Record<string, unknown>,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, controls: next })
}
