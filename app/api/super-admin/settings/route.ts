import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'

const patchInput = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(500),
})

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: settings } = await db
    .from('settings')
    .select('key, value, updated_at')
    .order('key', { ascending: true })

  return NextResponse.json({ settings: settings ?? [] })
}

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('settings')
    .select('value')
    .eq('key', parsed.data.key)
    .maybeSingle()

  await db.from('settings').upsert(
    { key: parsed.data.key, value: parsed.data.value, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'settings_update',
    target_table: 'settings',
    target_id: parsed.data.key,
    old_value: existing ? { value: existing.value } : undefined,
    new_value: { value: parsed.data.value },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
