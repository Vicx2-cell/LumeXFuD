import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const chat = readFileSync(join(process.cwd(), 'components', 'order-chat.tsx'), 'utf8')
const transcript = readFileSync(join(process.cwd(), 'components', 'admin', 'order-dispute-transcript.tsx'), 'utf8')

describe('order communication accessibility', () => {
  it('announces incoming messages and composer state', () => {
    expect(chat).toContain('role="log"')
    expect(chat).toContain('aria-relevant="additions text"')
    expect(chat).toContain('aria-describedby=')
    expect(chat).toContain('role="status"')
  })

  it('supports focus trapping, focus restoration, Escape, and reduced motion', () => {
    for (const source of [chat, transcript]) {
      expect(source).toContain("event.key === 'Escape'")
      expect(source).toContain("event.key !== 'Tab'")
      expect(source).toContain('.focus()')
    }
    expect(chat).toContain("prefers-reduced-motion: reduce")
  })

  it('keeps interactive chat targets at least 44px high', () => {
    expect(chat).not.toContain('min-h-9')
    expect(chat).toContain('min-h-11')
  })
})
