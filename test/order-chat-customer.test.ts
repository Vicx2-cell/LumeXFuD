import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(process.cwd(), 'app', 'order', '[orderNumber]', 'page.tsx'), 'utf8')
const client = readFileSync(join(process.cwd(), 'app', 'order', '[orderNumber]', 'order-status-client.tsx'), 'utf8')

describe('customer order communication integration', () => {
  it('passes a chat actor only for the owning customer role', () => {
    expect(page).toContain("session.role === 'customer' && session.userId")
    expect(page).toContain("type: 'CUSTOMER'")
  })

  it('offers only the assigned-rider channel and never a vendor channel', () => {
    expect(client).toContain('order.rider_id && !isPickup')
    expect(client).toContain('channel="CUSTOMER_RIDER"')
    expect(client).not.toContain('channel="CUSTOMER_VENDOR"')
    expect(client).not.toContain('Message Vendor')
  })
})
