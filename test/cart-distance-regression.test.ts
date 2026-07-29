import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const cart = readFileSync('app/cart/page.tsx', 'utf8')
const estimateRoute = readFileSync('app/api/orders/estimate/route.ts', 'utf8')

describe('mobile cart delivery-distance production regression', () => {
  it('does not invoke toFixed directly on the response distance', () => {
    expect(cart).not.toMatch(/distanceKm\s*\.\s*toFixed/)
    expect(cart).toContain("deliveryDistanceLabel ?? 'Distance unavailable'")
    expect(cart).toContain('parseDeliveryEstimate(data?.estimate)')
  })

  it('canonicalizes the launch quote before returning it to Safari or any other client', () => {
    expect(estimateRoute).toContain('toDeliveryEstimateResponse(launchQuote)')
    expect(estimateRoute).toContain('Could not calculate a valid delivery quote.')
    expect(estimateRoute).not.toContain('NextResponse.json({ estimate: launchQuote })')
  })
})
