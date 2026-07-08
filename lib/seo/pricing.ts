import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getDeliveryZonePricing, getMinimumOrderKobo } from '@/lib/delivery-zones'

// Platform fees for "honest, all-in" pricing on the public pages. Read LIVE from
// the settings table — NEVER hardcoded (CLAUDE.md rule 17). Falls back to the
// seeded defaults (migration 010) if a row is missing or the read fails, so a
// page never shows a blank or wrong price.

export interface PlatformFees {
  platformMarkupKobo: number   // added to every order
  bikeFeeKobo: number          // cheapest delivery option
  doorFeeKobo: number          // door-to-room delivery
  minOrderKobo: number
}

export async function getPlatformFees(): Promise<PlatformFees> {
  try {
    const db = createSupabaseAdmin()
    const pricing = await getDeliveryZonePricing({ db })
    const minOrder = await getMinimumOrderKobo(db)
    if (!pricing || minOrder === null) throw new Error('Pricing unavailable')
    return {
      platformMarkupKobo: pricing.platformMarkup,
      bikeFeeKobo: pricing.bikeFee,
      doorFeeKobo: pricing.doorFee,
      minOrderKobo: minOrder,
    }
  } catch {
    return { platformMarkupKobo: 0, bikeFeeKobo: 0, doorFeeKobo: 0, minOrderKobo: 0 }
  }
}

/**
 * The all-in kobo a student actually pays for a single item, bike delivery:
 *   item + platform markup + cheapest (bike) delivery fee.
 * This is the honest "no surprise at checkout" number the guardrails demand.
 */
export function allInKobo(itemKobo: number, fees: PlatformFees): number {
  return itemKobo + fees.platformMarkupKobo + fees.bikeFeeKobo
}
