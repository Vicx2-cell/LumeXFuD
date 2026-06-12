import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { FEATURES, getAllFeatures, featureSettingId } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// List the flag catalog with current on/off state.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const values = await getAllFeatures()
  const features = FEATURES.map((f) => ({
    key: f.key, label: f.label, description: f.description, enforced: f.enforced,
    enabled: values[f.key],
  }))
  return NextResponse.json({ features })
}

const patchInput = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
})

// Toggle a single feature on/off.
export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`super-features:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  if (!FEATURES.some((f) => f.key === parsed.data.key)) {
    return NextResponse.json({ error: 'Unknown feature' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const id = featureSettingId(parsed.data.key)
  const { data: existing } = await db.from('settings').select('value').eq('id', id).maybeSingle()

  const { error } = await db.from('settings').upsert(
    { id, value: { enabled: parsed.data.enabled }, updated_by: session.phone, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: parsed.data.enabled ? 'feature_enable' : 'feature_disable',
    target_table: 'settings',
    target_id: id,
    old_value: existing ? { value: existing.value } : undefined,
    new_value: { enabled: parsed.data.enabled },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
