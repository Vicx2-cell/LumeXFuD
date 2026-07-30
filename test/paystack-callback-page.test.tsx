import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PaystackCallbackPage from '@/app/paystack/callback/page'

describe('Paystack callback page', () => {
  it('shows processing state only', async () => {
    const markup = renderToStaticMarkup(await PaystackCallbackPage({
      searchParams: Promise.resolve({ order: 'LXF-2026-000001', intent: 'PINT-order-1' }),
    }))

    expect(markup).toContain('Processing payment')
    expect(markup).toContain('Your checkout is being verified')
    expect(markup).toContain('does not mark anything paid')
  })
})
