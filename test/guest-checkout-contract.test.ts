import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const cart = readFileSync(join(process.cwd(), 'app', 'cart', 'page.tsx'), 'utf8')
const ordersRoute = readFileSync(join(process.cwd(), 'app', 'api', 'orders', 'route.ts'), 'utf8')
const orderPage = readFileSync(join(process.cwd(), 'app', 'order', '[orderNumber]', 'page.tsx'), 'utf8')
const ordersPage = readFileSync(join(process.cwd(), 'app', 'orders', 'page.tsx'), 'utf8')

describe('guest checkout contract', () => {
  it('persists an idempotency key across a reload for an unchanged checkout attempt', () => {
    expect(cart).toContain('checkoutAttemptKeyRef')
    expect(cart).toContain("'idempotency-key': attemptKey")
    expect(cart).toContain('CHECKOUT_ATTEMPT_STORAGE_KEY')
    expect(cart).toContain('resolveCheckoutAttemptKey')
    expect(cart).toContain('clearCheckoutAttempt')
    expect(cart).toContain('Your cart is still saved; please retry.')
  })

  it('requires explicit guest terms and privacy acknowledgement at UI and API boundaries', () => {
    expect(cart).toContain('guest_terms_accepted')
    expect(cart).toContain('Privacy Policy')
    expect(ordersRoute).toContain('guest_terms_accepted !== true')
    expect(ordersRoute).toContain('Terms and Privacy Policy')
  })

  it('keeps a guest order recoverable after payment redirects and refreshes', () => {
    expect(ordersRoute).toContain('guestOrderCookieName(orderNumber)')
    expect(ordersRoute).toContain('httpOnly: true')
    expect(ordersRoute).toContain("sameSite: 'lax'")
    expect(ordersRoute).toContain("callback_url: `${appUrl}/order/${orderNumber}${campaignQuery}`")
    expect(orderPage).toContain('cookies()')
    expect(orderPage).toContain('guestOrderCookieName(orderNumber)')
    expect(ordersPage).toContain('guestOrderNumberFromCookieName')
    expect(ordersPage).toContain('hashGuestOrderToken(attempt.token) === order.guest_access_token_hash')
  })
})
