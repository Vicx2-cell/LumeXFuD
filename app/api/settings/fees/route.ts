import { NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getControls } from '@/lib/controls'

// Always compute per-request from the live settings — never let this GET be
// prerendered/cached at build, or a pricing change wouldn't reach the cart copy.
export const dynamic = 'force-dynamic'
export const revalidate = 0

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

  const result: Record<string, number | string> = {}
  for (const [outKey, id] of Object.entries(FEE_MAP)) {
    const v = byId.get(id)?.amount_kobo
    if (typeof v === 'number') result[outKey] = v
  }

  // Public display settings the cart needs: the live opening hours (so the
  // scheduled-order hint reflects super-admin edits instead of a hardcoded time).
  const controls = await getControls()
  result.hours_open = controls.hours_open
  result.hours_close = controls.hours_close

  // Live wallet top-up bonus % so copy ("get X% bonus") never hardcodes it.
  const { data: bonusRow } = await db.from('settings').select('value').eq('id', 'wallet_topup_bonus_percent').maybeSingle()
  const bonus = (bonusRow?.value as { value?: number } | undefined)?.value
  result.topup_bonus_percent = typeof bonus === 'number' && Number.isFinite(bonus) ? bonus : 0

  // No caching: a stale fee here means the customer is shown a price that
  // differs from the authoritative server-side calc at checkout. Prices change
  // rarely, so always serving fresh is cheap and avoids that mismatch.
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
