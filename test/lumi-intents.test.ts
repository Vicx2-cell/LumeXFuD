import { describe, it, expect } from 'vitest'
import { matchIntent } from '@/lib/lumi/intents'

describe('Lumi intent matcher', () => {
  it('matches check_balance', () => {
    expect(matchIntent('what is my wallet balance').intent).toBe('check_balance')
  })

  it('matches browse_vendors', () => {
    expect(matchIntent('show vendors near me').intent).toBe('browse_vendors')
  })

  it('extracts vendor for view_menu', () => {
    const r = matchIntent('show me menu from Mama T')
    expect(r.intent).toBe('view_menu')
    expect(r.entities.vendor).toBeDefined()
  })

  it('parses place_order with qty and vendor', () => {
    const r = matchIntent("Order 2 jollof from Mama T")
    expect(r.intent).toBe('place_order')
    expect(r.entities.quantity).toBe(2)
    expect(r.entities.vendor).toBeDefined()
  })

  it('returns fallback for empty message', () => {
    expect(matchIntent('   ').intent).toBe('fallback')
  })

  it('matches fund_wallet with amount', () => {
    const r = matchIntent('deposit 500')
    expect(r.intent).toBe('fund_wallet')
    expect(r.entities.amount).toBe(500)
  })
})
