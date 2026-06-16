import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

async function authAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (!['admin', 'super_admin'].includes(session.role)) return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

// GET /api/admin/lodges — full list (incl. unverified/inactive) for management.
export async function GET() {
  const { err } = await authAdmin()
  if (err) return err
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('lodges')
    .select('id, name, area, latitude, longitude, is_verified, is_active, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  return NextResponse.json({ lodges: data ?? [] })
}

const createInput = z.object({
  name:      z.string().trim().min(2).max(120),
  area:      z.string().trim().max(120).optional(),
  latitude:  z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  verified:  z.boolean().optional().default(true),
})

// POST /api/admin/lodges — add a lodge.
export async function POST(req: NextRequest) {
  const { err, session } = await authAdmin()
  if (err || !session) return err!

  const rl = await rateLimitGeneric(`admin-lodges:${session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = createInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })

  const { name, area, latitude, longitude, verified } = parsed.data
  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('lodges')
    .insert({
      name,
      area: area ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      is_verified: verified,
      created_by: session.phone,
      updated_at: new Date().toISOString(),
    })
    .select('id, name, area, latitude, longitude, is_verified, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A lodge with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Could not save lodge' }, { status: 500 })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'lodge_added',
    target_table: 'lodges',
    target_id: data.id,
    new_value: { name, area: area ?? null, verified },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ lodge: data })
}
