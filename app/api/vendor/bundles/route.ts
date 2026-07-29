import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { toKobo } from '@/lib/money'

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  priceNaira: z.number().positive().max(10_000_000),
  imageUrl: z.string().url().nullable().optional(),
  primaryMenuItemId: z.string().uuid(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1).max(30),
  publish: z.boolean().default(false),
})

async function requireVendor() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'vendor' || !session.userId) return { error: NextResponse.json({ error: 'Vendor only' }, { status: 403 }) }
  return { vendorId: session.userId }
}

export async function GET() {
  const gate = await requireVendor()
  if ('error' in gate) return gate.error
  const db = createSupabaseAdmin()
  const { data, error } = await db.from('menu_bundles')
    .select('id, name, description, price_kobo, image_url, primary_menu_item_id, is_active, published_at, created_at, menu_bundle_items(menu_item_id, quantity)')
    .eq('vendor_id', gate.vendorId).is('deleted_at', null).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bundles: data ?? [] })
}

export async function POST(req: NextRequest) {
  const gate = await requireVendor()
  if ('error' in gate) return gate.error
  const limit = await rateLimitGeneric(`bundle-write:${gate.vendorId}`, 30, 300)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bundle' }, { status: 400 })
  const input = parsed.data
  const ids = [...new Set(input.items.map((item) => item.menuItemId))]
  if (!ids.includes(input.primaryMenuItemId)) {
    return NextResponse.json({ error: 'The primary item must be included in the bundle' }, { status: 400 })
  }
  const db = createSupabaseAdmin()
  const { data: owned } = await db.from('menu_items').select('id, price_kobo, is_available, deleted_at')
    .eq('vendor_id', gate.vendorId).in('id', ids)
  if ((owned ?? []).length !== ids.length || (input.publish && (owned ?? []).some((item) => !item.is_available || item.deleted_at))) {
    return NextResponse.json({ error: 'Every bundle item must be an available item from your menu' }, { status: 409 })
  }
  const primary = (owned ?? []).find((item) => item.id === input.primaryMenuItemId)
  if (!primary || Number(primary.price_kobo) !== toKobo(input.priceNaira)) {
    return NextResponse.json({ error: 'Bundle price must match the selected orderable primary menu item' }, { status: 409 })
  }
  const now = new Date().toISOString()
  const { data: bundle, error } = await db.from('menu_bundles').insert({
    vendor_id: gate.vendorId,
    name: input.name,
    description: input.description ?? null,
    price_kobo: toKobo(input.priceNaira),
    image_url: input.imageUrl ?? null,
    primary_menu_item_id: input.primaryMenuItemId,
    is_active: false,
  }).select('id').single()
  if (error || !bundle) return NextResponse.json({ error: error?.message ?? 'Could not create bundle' }, { status: 500 })
  const { error: itemError } = await db.from('menu_bundle_items').insert(input.items.map((item) => ({
    bundle_id: bundle.id, menu_item_id: item.menuItemId, quantity: item.quantity,
  })))
  if (itemError) {
    await db.from('menu_bundles').update({ deleted_at: now }).eq('id', bundle.id).eq('vendor_id', gate.vendorId)
    return NextResponse.json({ error: 'Could not attach bundle items' }, { status: 500 })
  }
  if (input.publish) {
    const { error: publishError } = await db.from('menu_bundles').update({
      is_active: true, published_at: now, updated_at: now,
    }).eq('id', bundle.id).eq('vendor_id', gate.vendorId)
    if (publishError) return NextResponse.json({ error: 'Bundle was saved as a draft but could not be published' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: bundle.id, published: input.publish })
}
