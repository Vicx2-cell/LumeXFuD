import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const chat = readFileSync(join(process.cwd(), 'components', 'order-chat.tsx'), 'utf8')
const transcript = readFileSync(join(process.cwd(), 'components', 'admin', 'order-dispute-transcript.tsx'), 'utf8')
const vendor = readFileSync(join(process.cwd(), 'components', 'vendor-dashboard', 'orders-client.tsx'), 'utf8')

describe('order communication responsive behavior', () => {
  it('uses dynamic viewport height on mobile and a bounded desktop sheet', () => {
    for (const source of [chat, transcript]) {
      expect(source).toContain('92dvh')
      expect(source).toContain('max-w-[100vw]')
      expect(source).toContain('sm:h-[min(85dvh')
      expect(source).toContain('sm:rounded-3xl')
    }
  })

  it('contains touch scrolling and prevents composer overflow', () => {
    expect(chat).toContain('overscroll-contain')
    expect(chat).toContain('touch-pan-y')
    expect(chat).toContain('min-w-0 max-h-28')
    expect(chat).toContain('shrink-0 border-t')
  })

  it('allows dense vendor card actions to wrap at 375px', () => {
    expect(vendor).toContain('flex flex-wrap items-center justify-end')
    expect(vendor).toContain('label="Rider chat"')
  })
})
