import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const client = readFileSync(join(process.cwd(), 'components', 'vendor-dashboard', 'orders-client.tsx'), 'utf8')
const route = readFileSync(join(process.cwd(), 'app', 'api', 'vendor', 'orders', 'route.ts'), 'utf8')

describe('vendor order communication integration', () => {
  it('loads only assigned rider identity with vendor-scoped orders', () => {
    expect(route).toContain('customer_id, rider_id')
    expect(route).toContain('riders ( full_name )')
    expect(route).toContain(".eq('vendor_id', vendor.id)")
  })

  it('offers only vendor ↔ assigned rider chat', () => {
    expect(client).toContain('order.rider_id && !isPickup')
    expect(client).toContain('channel="VENDOR_RIDER"')
    expect(client).toContain("type: 'VENDOR'")
    expect(client).not.toContain('CUSTOMER_VENDOR')
  })

  it('does not expose a customer messaging action to vendors', () => {
    expect(client).not.toContain('waLink(')
    expect(client).not.toContain('Reach the customer')
  })
})
