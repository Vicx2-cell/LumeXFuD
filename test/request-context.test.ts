import { describe, expect, it } from 'vitest'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

describe('request context', () => {
  it('generates its own request ID and continues a valid correlation ID', () => {
    const headers = new Headers({
      'x-request-id': 'attacker-chosen-request-id',
      'x-correlation-id': 'checkout:01HZX6YJQ2QYH7W9Z1',
    })
    const context = createRequestContext(headers)
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(context.requestId).not.toBe('attacker-chosen-request-id')
    expect(context.correlationId).toBe('checkout:01HZX6YJQ2QYH7W9Z1')
  })

  it('replaces malformed, short, or oversized correlation IDs', () => {
    for (const value of ['short', 'contains spaces', 'x'.repeat(129), '<script>bad</script>']) {
      const context = createRequestContext(new Headers({ 'x-correlation-id': value }))
      expect(context.correlationId).toBe(context.requestId)
    }
  })

  it('exposes both identifiers on the response', () => {
    const context = createRequestContext(new Headers())
    const response = applyRequestContext(new Response(null), context)
    expect(response.headers.get('x-request-id')).toBe(context.requestId)
    expect(response.headers.get('x-correlation-id')).toBe(context.correlationId)
  })
})
