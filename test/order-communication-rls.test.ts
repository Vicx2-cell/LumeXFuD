import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '123_order_communication_rls.sql'),
  'utf8',
)

describe('migration 123 — order communication RLS', () => {
  it('allows only the two explicitly permitted participant relationships', () => {
    expect(sql).toContain("channel = 'CUSTOMER_RIDER'")
    expect(sql).toContain("channel = 'VENDOR_RIDER'")
    expect(sql).not.toContain("channel = 'CUSTOMER_VENDOR'")
  })

  it('binds rider reads to both the conversation and current order assignment', () => {
    expect(sql).toMatch(/o\.rider_id\s*=\s*oc\.rider_id/i)
    expect(sql).toMatch(/FROM riders r[\s\S]*r\.id = oc\.rider_id/i)
    expect(sql).toContain('can_read_order_conversation(order_messages.conversation_id)')
  })

  it('does not ship a permissive policy', () => {
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(sql).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i)
  })

  it('makes direct clients read-only and denies anon entirely', () => {
    expect(sql).toMatch(/REVOKE ALL[\s\S]*FROM anon/i)
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE[\s\S]*FROM authenticated/i)
    expect(sql).toMatch(/GRANT SELECT[\s\S]*TO authenticated/i)
  })
})
