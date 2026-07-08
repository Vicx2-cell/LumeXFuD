import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createMenuItemInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { toKobo } from '@/lib/money'

interface AddonRow {
  id: string
  menu_item_id: string
  name: string
  price_kobo: number
  is_available: boolean
  display_order: number
}

// GET /api/vendor/menu — the logged-in vendor's own items + their add-ons.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: items } = await db
    .from('menu_items')
    .select('id, name, description, price_kobo, image_url, category, product_category, prescription_required, is_available, sold_out_until, prep_time_minutes, display_order')
    .eq('vendor_id', session.userId!)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })

  const list = (items ?? []) as Array<{ id: string }>
  const itemIds = list.map((i) => i.id)

  let addons: AddonRow[] = []
  if (itemIds.length > 0) {
    const { data } = await db
      .from('menu_item_addons')
      .select('id, menu_item_id, name, price_kobo, is_available, display_order')
      .in('menu_item_id', itemIds)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
    addons = (data ?? []) as AddonRow[]
  }

  const byItem = new Map<string, AddonRow[]>()
  for (const a of addons) {
    const arr = byItem.get(a.menu_item_id) ?? []
    arr.push(a)
    byItem.set(a.menu_item_id, arr)
  }

  const result = list.map((i) => ({ ...i, addons: byItem.get(i.id) ?? [] }))
  return NextResponse.json({ items: result })
}

// POST /api/vendor/menu — create a food item (+ optional add-ons).
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const rl = await rateLimitGeneric(`menu-write:${session.userId ?? session.phone}`, 60, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let parsed
  try {
    parsed = createMenuItemInput.parse(await req.json())
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const priceKobo = toKobo(parsed.price_naira)

  const { data: item, error } = await db
    .from('menu_items')
    .insert({
      vendor_id:    session.userId!,
      name:         parsed.name,
      price_kobo:   priceKobo,
      price:        priceKobo, // legacy NOT NULL column in the live DB
      category:     parsed.category,
      description:  parsed.description ?? null,
      image_url:    parsed.image_url ?? null,
      is_available: parsed.is_available ?? true,
      prep_time_minutes: parsed.prep_time_minutes ?? null,
      prescription_required: parsed.prescription_required ?? false,
    })
    .select('id')
    .single()

  if (error || !item) {
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
  }

  if (parsed.addons.length > 0) {
    await db.from('menu_item_addons').insert(
      parsed.addons.map((a, idx) => ({
        menu_item_id:  item.id,
        name:          a.name,
        price_kobo:    toKobo(a.price_naira),
        display_order: idx,
      }))
    )
  }

  return NextResponse.json({ success: true, id: item.id })
}
