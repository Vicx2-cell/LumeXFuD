import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const cart = readFileSync(join(process.cwd(), 'app', 'cart', 'page.tsx'), 'utf8')
const ordersRoute = readFileSync(join(process.cwd(), 'app', 'api', 'orders', 'route.ts'), 'utf8')

describe('guest checkout contract', () => {
  it('sends an idempotency key and keeps retry ownership client-side', () => {
    expect(cart).toContain('checkoutAttemptKeyRef')
    expect(cart).toContain("'idempotency-key': checkoutAttemptKeyRef.current")
    expect(cart).toContain('checkoutAttemptKeyRef.current = null')
  })

  it('requires explicit guest terms and privacy acknowledgement at UI and API boundaries', () => {
    expect(cart).toContain('guest_terms_accepted')
    expect(cart).toContain('Privacy Policy')
    expect(ordersRoute).toContain('guest_terms_accepted !== true')
    expect(ordersRoute).toContain('Terms and Privacy Policy')
  })
})

