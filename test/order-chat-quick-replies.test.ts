import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components', 'order-chat.tsx'), 'utf8')

describe('order chat quick replies', () => {
  it('defines replies for every permitted directional relationship', () => {
    expect(source).toContain("actorType === 'CUSTOMER' && channel === 'CUSTOMER_RIDER'")
    expect(source).toContain("actorType === 'VENDOR' && channel === 'VENDOR_RIDER'")
    expect(source).toContain("actorType === 'RIDER' && channel === 'CUSTOMER_RIDER'")
    expect(source).toContain("actorType === 'RIDER' && channel === 'VENDOR_RIDER'")
  })

  it('puts a quick reply into the reviewed draft instead of auto-sending it', () => {
    expect(source).toContain('setDraft(reply)')
    expect(source).not.toMatch(/onClick=\{\(\) =>[^}]*send\(reply\)/)
  })
})
