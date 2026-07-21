import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rider = readFileSync(join(process.cwd(), 'app', 'rider', 'page.tsx'), 'utf8')

describe('rider order communication integration', () => {
  it('offers exactly the customer and vendor order channels', () => {
    expect(rider).toContain("setChatChannel('CUSTOMER_RIDER')")
    expect(rider).toContain("setChatChannel('VENDOR_RIDER')")
    expect(rider).not.toContain('CUSTOMER_VENDOR')
  })

  it('binds chat to the current active order and authenticated rider', () => {
    expect(rider).toContain('current && rider && chatChannel')
    expect(rider).toContain("actor={{ id: rider.id, type: 'RIDER' }}")
  })

  it('keeps order messages inside LumeX rather than WhatsApp', () => {
    expect(rider).not.toContain('waLink(')
    expect(rider).not.toContain('Message customer on WhatsApp')
    expect(rider).not.toContain('Message vendor on WhatsApp')
  })
})
