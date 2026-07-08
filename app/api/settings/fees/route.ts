import { NextResponse } from 'next/server'
import { getControls } from '@/lib/controls'
import { getDeliveryZonePricing } from '@/lib/delivery-zones'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// Always compute per-request from the live settings — never let this GET be
// prerendered/cached at build, or a pricing change wouldn't reach the cart copy.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const db = createSupabaseAdmin()
  const result: Record<string, number | string> = {}
  const pricing = await getDeliveryZonePricing({ db })
  if (pricing) {
    result.platform_markup_kobo = pricing.platformMarkup
    result.bike_delivery_fee_kobo = pricing.bikeFee
    result.door_delivery_fee_kobo = pricing.doorFee
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
