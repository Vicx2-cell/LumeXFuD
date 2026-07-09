import { describe, expect, it } from 'vitest'
import { isFlowExitMessage, matchIntent } from '@/lib/lumi/intents'

describe('Lumi intent matcher', () => {
  it('falls back for empty and punctuation-only input', () => {
    expect(matchIntent('').intent).toBe('fallback')
    expect(matchIntent('   ').intent).toBe('fallback')
    expect(matchIntent('!!!').intent).toBe('fallback')
  })

  it('matches balance phrases', () => {
    expect(matchIntent('check my balance').intent).toBe('check_balance')
    expect(matchIntent('How much do I have?').intent).toBe('check_balance')
    expect(matchIntent('show wallet').intent).toBe('check_balance')
  })

  it('matches vendor browsing phrases', () => {
    expect(matchIntent('show vendors').intent).toBe('browse_vendors')
    expect(matchIntent('where can I order?').intent).toBe('browse_vendors')
    expect(matchIntent('available restaurants').intent).toBe('browse_vendors')
  })

  it('matches menu phrases and extracts vendor names', () => {
    const mamaT = matchIntent("Show Mama T's menu")
    expect(mamaT.intent).toBe('view_menu')
    expect(mamaT.entities.vendorName).toBe('mama t')

    const chickenRepublic = matchIntent('menu for Chicken Republic')
    expect(chickenRepublic.intent).toBe('view_menu')
    expect(chickenRepublic.entities.vendorName).toBe('chicken republic')

    expect(matchIntent('view menu').intent).toBe('view_menu')
  })

  it('matches order phrases and extracts entities', () => {
    const order = matchIntent('order 2 jollof rice')
    expect(order.intent).toBe('place_order')
    expect(order.entities.quantity).toBe(2)
    expect(order.entities.itemName).toBe('jollof rice')

    const words = matchIntent('I want three meat pies')
    expect(words.intent).toBe('place_order')
    expect(words.entities.quantity).toBe(3)
    expect(words.entities.itemName).toBe('meat pies')

    const vendor = matchIntent('buy one shawarma from Mama T')
    expect(vendor.entities.quantity).toBe(1)
    expect(vendor.entities.vendorName).toBe('mama t')
  })

  it('matches order status phrases', () => {
    expect(matchIntent('track my order').intent).toBe('order_status')
    expect(matchIntent('where is my food?').intent).toBe('order_status')
    expect(matchIntent('check order LM123').entities.orderId).toBe('LM123')
  })

  it('matches wallet funding phrases and amounts', () => {
    expect(matchIntent('fund my wallet').intent).toBe('fund_wallet')
    expect(matchIntent('add ₦5,000').entities.amount).toBe(5000)
    expect(matchIntent('deposit 2000').entities.amount).toBe(2000)
    expect(matchIntent('top up with 3,500').entities.amount).toBe(3500)
  })

  it('matches withdrawals conservatively', () => {
    const withdraw = matchIntent('withdraw ₦2,000')
    expect(withdraw.intent).toBe('withdraw')
    expect(withdraw.entities.amount).toBe(2000)

    const weak = matchIntent('money please')
    expect(weak.intent).toBe('fallback')
  })

  it('matches cancellations and extracts order ids', () => {
    expect(matchIntent('cancel my order').intent).toBe('cancel_order')
    expect(matchIntent('cancel order LM123').entities.orderId).toBe('LM123')
  })

  it('matches help phrases', () => {
    expect(matchIntent('help').intent).toBe('help')
    expect(matchIntent('what can you do?').intent).toBe('help')
  })

  it('normalizes capitalization, punctuation, naira symbols, and spacing', () => {
    const result = matchIntent('  Add   ₦2,000!!! ')
    expect(result.intent).toBe('fund_wallet')
    expect(result.entities.amount).toBe(2000)
    expect(result.normalizedMessage).toContain('naira')
  })

  it('prefers destructive or financial commands only when explicit', () => {
    expect(matchIntent('cancel my order and show vendors').intent).toBe('cancel_order')
    expect(matchIntent('show vendors and check my balance').intent).toBe('check_balance')
  })

  it('does not confuse vendor names with intent words', () => {
    const result = matchIntent("show menu for Help Kitchen")
    expect(result.intent).toBe('view_menu')
    expect(result.entities.vendorName).toBe('help kitchen')
  })

  it('recognizes flow exit phrases', () => {
    expect(isFlowExitMessage('cancel')).toBe(true)
    expect(isFlowExitMessage('never mind')).toBe(true)
    expect(isFlowExitMessage('carry on')).toBe(false)
  })
})
