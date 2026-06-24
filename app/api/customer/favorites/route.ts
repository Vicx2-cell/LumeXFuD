import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const Body = z.object({ vendor_id: z.string().uuid() }).strict()

async function requireCustomer() {
  const user = await getCurrentUser()
  if (!user?.userId || user.role !== 'customer') return null
  return user
}

// GET /api/customer/favorites — the current customer's favourite vendor ids.
export async function GET() {
  const user = await requireCustomer()
  if (!user) return NextResponse.json({ favorites: [] })
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('customer_favorites')
    .select('vendor_id')
    .eq('customer_id', user.userId)
  return NextResponse.json({ favorites: (data ?? []).map((r) => r.vendor_id as string) })
}

// POST /api/customer/favorites { vendor_id } — heart a vendor (idempotent).
export async function POST(req: NextRequest) {
  const user = await requireCustomer()
  if (!user) return NextResponse.json({ error: 'Customers only' }, { status: 403 })
  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'vendor_id required' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { error } = await db
    .from('customer_favorites')
    .upsert({ customer_id: user.userId, vendor_id: parsed.data.vendor_id }, { onConflict: 'customer_id,vendor_id' })
  if (error) return NextResponse.json({ error: 'Could not save favourite' }, { status: 500 })
  return NextResponse.json({ ok: true, favorited: true })
}

// DELETE /api/customer/favorites { vendor_id } — un-heart.
export async function DELETE(req: NextRequest) {
  const user = await requireCustomer()
  if (!user) return NextResponse.json({ error: 'Customers only' }, { status: 403 })
  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'vendor_id required' }, { status: 400 })

  const db = createSupabaseAdmin()
  await db.from('customer_favorites').delete().eq('customer_id', user.userId).eq('vendor_id', parsed.data.vendor_id)
  return NextResponse.json({ ok: true, favorited: false })
}
