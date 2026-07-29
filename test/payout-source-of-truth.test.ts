import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('payout source of truth', () => {
  it('delegates the release cron instead of reimplementing vendor settlement', () => {
    const source = readFileSync('app/api/cron/release-payments/route.ts', 'utf8')
    expect(source).toContain('await completeOrderPayout({')
    expect(source).not.toContain('const vendorAmount = Number(order.subtotal)')
    expect(source).not.toMatch(/userType:\s*['"]VENDOR['"][\s\S]{0,200}amount:\s*vendorAmount/)
  })
})
