import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('order creation fraud boundaries', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/orders/route.ts'), 'utf8')
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/136_order_intent_integrity.sql'), 'utf8')

  it('binds idempotency replay to the authoritative order intent', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS order_intent_hash TEXT/i)
    expect(route).toMatch(/order_intent_hash: orderIntentHash/i)
    expect(route).toMatch(/existing\.order_intent_hash !== orderIntentHash/i)
    expect(route.indexOf("outcome: 'payload_mismatch'")).toBeLessThan(route.indexOf("outcome: 'safe_replay'"))
  })

  it('enforces wrong-role and account/shared-network velocity boundaries', () => {
    expect(route).toMatch(/session\.role !== 'customer'/i)
    expect(route).toMatch(/outcome: 'wrong_role'/i)
    expect(route).toMatch(/order:create:network:/i)
    expect(route).toMatch(/order_shared_network_velocity/i)
    expect(route).toMatch(/order_account_velocity/i)
  })

  it('does not trust client prices or include sensitive address/location in the intent hash', () => {
    expect(route).toMatch(/SERVER-SIDE price calculation/i)
    expect(route).toMatch(/price_kobo/i)
    const helper = readFileSync(join(process.cwd(), 'lib/order-fraud.ts'), 'utf8')
    const canonical = helper.slice(helper.indexOf('const canonical'), helper.indexOf("return createHash"))
    expect(canonical).not.toMatch(/address|latitude|longitude|instruction/i)
  })
})
