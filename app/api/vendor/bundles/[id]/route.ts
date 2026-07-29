import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { toKobo } from '@/lib/money'

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  priceNaira: z.number().positive().max(10_000_000).optional(),
  imageUrl: z.string().url().nullable().optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor' || !session.userId) return NextResponse.json({ error: 'Vendor only' }, { status: 403 })
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid bundle id' }, { status: 400 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid bundle update' }, { status: 400 })
  const db = createSupabaseAdmin()
  if (parsed.data.active) {
    const { data: parts } = await db.from('menu_bundle_items')
      .select('menu_items!inner(is_available, deleted_at)').eq('bundle_id', id)
    if (!parts?.length || parts.some((part) => {
      const item = part.menu_items as unknown as { is_available: boolean; deleted_at: string | null }
      return !item.is_available || item.deleted_at
    })) return NextResponse.json({ error: 'A bundle can only be published when every item is available' }, { status: 409 })
  }
  const now = new Date().toISOString()
  const update = {
    name: parsed.data.name,
    description: parsed.data.description,
    price_kobo: parsed.data.priceNaira === undefined ? undefined : toKobo(parsed.data.priceNaira),
    image_url: parsed.data.imageUrl,
    is_active: parsed.data.active,
    published_at: parsed.data.active ? now : undefined,
    updated_at: now,
  }
  const clean = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined))
  const { data, error } = await db.from('menu_bundles').update(clean)
    .eq('id', id).eq('vendor_id', session.userId).is('deleted_at', null).select('id').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Bundle not found or update failed' }, { status: error ? 500 : 404 })
  return NextResponse.json({ ok: true, id })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor' || !session.userId) return NextResponse.json({ error: 'Vendor only' }, { status: 403 })
  const { id } = await params
  const now = new Date().toISOString()
  const db = createSupabaseAdmin()
  const { data } = await db.from('menu_bundles').update({
    is_active: false, deleted_at: now, updated_at: now,
  }).eq('id', id).eq('vendor_id', session.userId).is('deleted_at', null).select('id').maybeSingle()
  if (!data) return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
