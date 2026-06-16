import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { invalidateCustomerCountCache } from '@/lib/launch-counter'

export const runtime = 'nodejs'

// Super-admin only. Update a feature flag (enabled and/or config) and record an
// audit row. Role is verified IN CODE. .strict() rejects any unknown/extra field.
const configSchema = z.object({
  goal: z.number().int().min(1).max(1_000_000),
}).strict()

const bodySchema = z.object({
  key: z.string().min(1).max(64),
  enabled: z.boolean().optional(),
  config: configSchema.optional(),
}).strict().refine(
  (b) => b.enabled !== undefined || b.config !== undefined,
  { message: 'Provide enabled and/or config' },
)

// GET — current state of a flag, for the admin UI to render the toggle + goal.
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data } = await db
    .from('feature_flags')
    .select('key, enabled, config, updated_by, updated_at')
    .eq('key', key)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'Unknown flag' }, { status: 404 })

  return NextResponse.json({ flag: data })
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`admin-feature-flags:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  const { key, enabled, config } = parsed.data

  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('feature_flags')
    .select('enabled, config')
    .eq('key', key)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Unknown flag' }, { status: 404 })

  // Merge only the provided fields over the current row.
  const nextEnabled = enabled !== undefined ? enabled : Boolean(existing.enabled)
  const nextConfig = config !== undefined ? config : (existing.config ?? {})
  const changedBy = session.userId ?? session.phone
  const now = new Date().toISOString()

  const { error } = await db
    .from('feature_flags')
    .update({ enabled: nextEnabled, config: nextConfig, updated_by: changedBy, updated_at: now })
    .eq('key', key)
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })

  // Audit trail for every toggle (dedicated table, per spec) + super-audit log.
  await db.from('feature_flag_audit').insert({
    flag_key: key,
    old_value: { enabled: Boolean(existing.enabled), config: existing.config ?? {} },
    new_value: { enabled: nextEnabled, config: nextConfig },
    changed_by: changedBy,
    changed_at: now,
  })

  await superAudit({
    actor_id: changedBy,
    actor_role: session.role,
    action: 'feature_flag_update',
    target_table: 'feature_flags',
    target_id: key,
    old_value: { enabled: Boolean(existing.enabled), config: existing.config ?? {} },
    new_value: { enabled: nextEnabled, config: nextConfig },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  // The toggle can flip the public endpoint on/off; drop the cached count so a
  // freshly enabled counter reflects reality immediately.
  await invalidateCustomerCountCache()

  return NextResponse.json({ success: true, flag: { key, enabled: nextEnabled, config: nextConfig } })
}
