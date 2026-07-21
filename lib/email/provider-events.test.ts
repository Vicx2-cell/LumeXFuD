import { describe, expect, it } from 'vitest'
import { providerEventErrorCode, providerEventStatus } from './provider-events'

describe('Resend delivery event mapping', () => {
  it.each([
    ['email.sent', 'SENT'], ['email.delivered', 'DELIVERED'], ['email.delivery_delayed', 'DELIVERY_DELAYED'],
    ['email.bounced', 'BOUNCED'], ['email.suppressed', 'SUPPRESSED'], ['email.complained', 'COMPLAINED'], ['email.failed', 'FAILED'],
  ])('maps %s to %s', (event, status) => expect(providerEventStatus(event)).toBe(status))

  it('does not turn opens or clicks into operational state', () => {
    expect(providerEventStatus('email.opened')).toBeNull()
    expect(providerEventErrorCode('email.bounced')).toBe('provider_bounced')
  })
})
