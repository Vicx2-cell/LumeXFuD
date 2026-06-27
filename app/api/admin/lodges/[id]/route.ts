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
  blocks:      z.array(z.string().max(40)).max(80).optional(),
  is_verified: z.boolean().optional(),
  is_active:   z.boolean().optional(),
})

function cleanBlocks(blocks: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of blocks) {
    const b = raw.replace(/\s+/g, ' ').trim()
    if (!b) continue
    const key = b.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(b)
    if (out.length >= 50) break
  }
  return out
}

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

  // Blocks go through a SEPARATE tolerant update (migration 081 may be pending),
  // so editing name/area/coords/flags never fails on a missing column.
  const { blocks: blocksInput, ...baseFields } = parsed.data
  const blocks = blocksInput !== undefined ? cleanBlocks(blocksInput) : undefined

  const db = createSupabaseAdmin()

  if (Object.keys(baseFields).length === 0 && blocks !== undefined) {
    // Blocks-only edit: don't issue an empty base update.
    const res = await db.from('lodges').update({ blocks, updated_at: new Date().toISOString() }).eq('id', id)
      .select('id, name, area, latitude, longitude, is_verified, is_active, created_at').single()
    if (res.error) return NextResponse.json({ error: 'Could not update blocks' }, { status: 500 })
    await audit({ actor_id: session.phone, actor_role: session.role, action: 'lodge_updated', target_table: 'lodges', target_id: id, new_value: { blocks }, ip_address: req.headers.get('x-forwarded-for') ?? undefined })
    return NextResponse.json({ lodge: { ...res.data, blocks } })
  }

  const { data, error } = await db
    .from('lodges')
    .update({ ...baseFields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, name, area, latitude, longitude, is_verified, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A lodge with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Could not update lodge' }, { status: 500 })
  }

  if (blocks !== undefined) {
    await db.from('lodges').update({ blocks }).eq('id', id).then(() => {}, () => {})
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

  return NextResponse.json({ lodge: blocks !== undefined ? { ...data, blocks } : data })
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
