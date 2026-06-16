import { NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// Maps the cart's expected response keys → the id-keyed JSONB settings rows
// seeded in 010 (each shaped {"amount_kobo": N}). Display-only; the authoritative
// price calc happens server-side in POST /api/orders.
const FEE_MAP: Record<string, string> = {
  platform_markup_kobo:   'platform_markup',
  bike_delivery_fee_kobo: 'delivery_fee_bike',
  door_delivery_fee_kobo: 'delivery_fee_door',
}

export async function GET() {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('settings')
    .select('id, value')
    .in('id', Object.values(FEE_MAP))

  const byId = new Map<string, { amount_kobo?: number }>()
  for (const row of (data ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>) {
    byId.set(row.id, row.value)
  }

  const result: Record<string, number> = {}
  for (const [outKey, id] of Object.entries(FEE_MAP)) {
    const v = byId.get(id)?.amount_kobo
    if (typeof v === 'number') result[outKey] = v
  }

  // No caching: a stale fee here means the customer is shown a price that
  // differs from the authoritative server-side calc at checkout. Prices change
  // rarely, so always serving fresh is cheap and avoids that mismatch.
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
