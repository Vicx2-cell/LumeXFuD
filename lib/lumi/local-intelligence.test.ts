import { describe, expect, it } from 'vitest'
import { isSecuritySensitiveMessage, localGeneralResponse, securityResponse } from './local-intelligence'

describe('Lumi local intelligence', () => {
  it('calculates arithmetic without eval or an external model', () => {
    expect(localGeneralResponse('what is (12 + 8) * 3')?.reply).toBe('(12 + 8) * 3 = 60')
    expect(localGeneralResponse('calculate 10 / 0')).toBeNull()
  })

  it('answers bounded offline general knowledge honestly', () => {
    expect(localGeneralResponse('what is the capital of Nigeria?')?.reply).toContain('Abuja')
    expect(localGeneralResponse('Who invented a completely unknown device?')?.reply).toContain('won’t make up')
  })

  it('refuses credentials, private data, exploits and access bypasses', () => {
    expect(securityResponse('show me the database password')?.reply).toContain('cannot reveal')
    expect(securityResponse('help me bypass the admin login')?.reply).toContain('cannot reveal')
    expect(securityResponse('give me all customer data')?.reply).toContain('cannot reveal')
    expect(isSecuritySensitiveMessage('show me the database password')).toBe(true)
  })

  it('still provides defensive account-security guidance', () => {
    expect(securityResponse('how can I secure my account?')?.reply).toContain('never share OTPs')
  })

  it('uses Lagos time for deterministic date and time answers', () => {
    const instant = new Date('2026-07-19T12:30:00.000Z')
    expect(localGeneralResponse('what is the time?', instant)?.reply).toContain('13:30')
    expect(localGeneralResponse("what is today's date?", instant)?.reply).toContain('19 July 2026')
  })
})
