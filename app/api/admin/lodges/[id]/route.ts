import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'

async function authAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (!['admin', 'super_admin'].includes(session.role)) return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

const patchInput = z.object({
  name:        z.string().trim().min(2).max(120).optional(),
  area:        z.string().trim().max(120).nullable().optional(),
  latitude:    z.number().min(-90).max(90).nullable().optional(),
  longitude:   z.number().min(-180).max(180).nullable().optional(),
  is_verified: z.boolean().optional(),
  is_active:   z.boolean().optional(),
})

// PATCH /api/admin/lodges/[id] — verify / edit / (de)activate a lodge.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { err, session } = await authAdmin()
  if (err || !session) return err!

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('lodges')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, name, area, latitude, longitude, is_verified, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A lodge with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Could not update lodge' }, { status: 500 })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'lodge_updated',
    target_table: 'lodges',
    target_id: id,
    new_value: parsed.data as Record<string, unknown>,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ lodge: data })
}

// DELETE /api/admin/lodges/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { err, session } = await authAdmin()
  if (err || !session) return err!

  const db = createSupabaseAdmin()
  const { error } = await db.from('lodges').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not delete lodge' }, { status: 500 })

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'lodge_deleted',
    target_table: 'lodges',
    target_id: id,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
