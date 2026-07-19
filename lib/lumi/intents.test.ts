import { describe, expect, it } from 'vitest'
import { matchIntent } from './intents'

describe('Lumi local language understanding', () => {
  it('understands common typos', () => {
    expect(matchIntent('check my walet balnce').intent).toBe('check_balance')
    expect(matchIntent('show resturants around me').intent).toBe('browse_vendors')
  })

  it('understands concise Nigerian English', () => {
    expect(matchIntent('wetin remain for my wallet').intent).toBe('check_balance')
    expect(matchIntent('where my food dey').intent).toBe('order_status')
    expect(matchIntent('who dey open').intent).toBe('browse_vendors')
  })

  it('keeps unknown questions out of transactional intents', () => {
    expect(matchIntent('why is the sky blue?').intent).toBe('fallback')
  })
})
