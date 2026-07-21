import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components', 'order-chat.tsx'), 'utf8')

describe('shared order chat UI', () => {
  it('uses a modal bottom sheet with keyboard and screen-reader affordances', () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain("event.key !== 'Tab'")
    expect(source).toContain('aria-live="polite"')
  })

  it('enforces mobile tap targets and the server message length', () => {
    expect(source).toContain('min-h-11')
    expect(source).toContain('maxLength={300}')
    expect(source).toContain("event.key === 'Enter' && !event.shiftKey")
  })

  it('cleans up its event stream and avoids acknowledging optimistic rows', () => {
    expect(source).toContain('return () => source.close()')
    expect(source).toContain("!message.id.startsWith('optimistic:')")
  })
})
