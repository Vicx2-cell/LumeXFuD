import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { updateMenuItemInput } from '@/lib/validators'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { toKobo } from '@/lib/money'
import { generateFlyerVariants } from '@/lib/flyer-marketing'

// Next Africa/Lagos midnight (UTC+1, no DST) as a UTC ISO string. Computed
// server-side so the auto-restore time can never be spoofed by the client clock.
function nextLagosMidnightISO(): string {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000) // shift to Lagos wall clock
  const lagosMidnight = Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate() + 1, 0, 0, 0)
  return new Date(lagosMidnight - 60 * 60 * 1000).toISOString() // back to real UTC
}

// Confirm the item exists and belongs to the logged-in vendor (BOLA).
async function loadOwnedItem(db: ReturnType<typeof createSupabaseAdmin>, id: string, vendorId: string) {
  const { data } = await db
    .from('menu_items')
    .select('id, vendor_id, name, price_kobo, image_url, is_available, sold_out_until')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  const item = data as { id: string; vendor_id: string; name?: string | null; price_kobo?: number | null; image_url?: string | null; is_available?: boolean | null; sold_out_until?: string | null } | null
  if (!item) return { error: 'not_found' as const }
  if (item.vendor_id !== vendorId) return { error: 'forbidden' as const }
  return { item }
}

// PATCH /api/vendor/menu/[id] — edit fields / toggle availability / replace add-ons.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const rl = await rateLimitGeneric(`menu-write:${session.userId ?? session.phone}`, 60, 300)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let parsed
  try {
    parsed = updateMenuItemInput.parse(await req.json())
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const owned = await loadOwnedItem(db, id, session.userId!)
  if (owned.error === 'not_found') return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const previous = owned.item

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.name !== undefined) updates.name = parsed.name
  if (parsed.category !== undefined) updates.category = parsed.category
  if (parsed.description !== undefined) updates.description = parsed.description
  if (parsed.image_url !== undefined) updates.image_url = parsed.image_url
  if (parsed.sold_out_today === true) {
    // One-tap sell-out: hide now, auto-restore at next Lagos midnight (the cron).
    updates.is_available = false
    updates.sold_out_until = nextLagosMidnightISO()
  } else if (parsed.is_available !== undefined) {
    updates.is_available = parsed.is_available
    // A manual re-enable cancels any pending timed sell-out.
    if (parsed.is_available === true) updates.sold_out_until = null
  }
  if (parsed.prep_time_minutes !== undefined) updates.prep_time_minutes = parsed.prep_time_minutes
  if (parsed.prescription_required !== undefined) updates.prescription_required = parsed.prescription_required
  if (parsed.price_naira !== undefined) {
    const kobo = toKobo(parsed.price_naira)
    updates.price_kobo = kobo
    updates.price = kobo // keep legacy column in sync
  }

  await db.from('menu_items').update(updates).eq('id', id)

  // addons present → replace the whole list (hard delete is safe: orders snapshot
  // add-ons into order_items.addons JSONB, so nothing references these rows).
  if (parsed.addons !== undefined) {
    await db.from('menu_item_addons').delete().eq('menu_item_id', id)
    if (parsed.addons.length > 0) {
      await db.from('menu_item_addons').insert(
        parsed.addons.map((a, idx) => ({
          menu_item_id:  id,
          name:          a.name,
          price_kobo:    toKobo(a.price_naira),
          display_order: idx,
        }))
      )
    }
  }

  const becameAvailable =
    parsed.is_available === true &&
    previous?.is_available === false

  if (becameAvailable) {
    try {
      await generateFlyerVariants(db, {
        eventType: 'menu_item.back_in_stock',
        vendorId: session.userId!,
        sourceEntityId: id,
        payload: {
          mealId: id,
          mealName: parsed.name ?? previous?.name ?? 'Back in stock',
          mealPrice: parsed.price_naira !== undefined ? `\u20A6${parsed.price_naira.toLocaleString('en-NG')}` : previous?.price_kobo ? `\u20A6${Math.round((previous.price_kobo ?? 0) / 100).toLocaleString('en-NG')}` : '',
        },
      })
    } catch (err) {
      console.error('[flyer-marketing] menu_item.back_in_stock failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/vendor/menu/[id] — soft delete the item.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const owned = await loadOwnedItem(db, id, session.userId!)
  if (owned.error === 'not_found') return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (owned.error === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await db.from('menu_items').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ success: true })
}
