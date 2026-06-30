import { createSupabaseAdmin } from '@/lib/supabase/server'

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

// Seeded defaults (kobo) — mirror migration 010_seed_settings.sql.
const FALLBACK: PlatformFees = {
  platformMarkupKobo: 25000,  // ₦250
  bikeFeeKobo: 50000,         // ₦500
  doorFeeKobo: 100000,        // ₦1,000
  minOrderKobo: 50000,        // ₦500
}

function amount(value: unknown, fallback: number): number {
  if (value && typeof value === 'object' && 'amount_kobo' in value) {
    const n = Number((value as { amount_kobo: unknown }).amount_kobo)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return fallback
}

export async function getPlatformFees(): Promise<PlatformFees> {
  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('settings')
      .select('id, value')
      .in('id', ['platform_markup', 'delivery_fee_bike', 'delivery_fee_door', 'min_order_amount'])
    const map = new Map<string, unknown>((data ?? []).map((r) => [r.id as string, r.value]))
    return {
      platformMarkupKobo: amount(map.get('platform_markup'), FALLBACK.platformMarkupKobo),
      bikeFeeKobo: amount(map.get('delivery_fee_bike'), FALLBACK.bikeFeeKobo),
      doorFeeKobo: amount(map.get('delivery_fee_door'), FALLBACK.doorFeeKobo),
      minOrderKobo: amount(map.get('min_order_amount'), FALLBACK.minOrderKobo),
    }
  } catch {
    return { ...FALLBACK }
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
