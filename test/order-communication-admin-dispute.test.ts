import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const route = readFileSync(
  join(process.cwd(), 'app', 'api', 'admin', 'disputes', '[id]', 'messages', 'route.ts'),
  'utf8',
)
const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '127_order_communication_dispute_rls.sql'),
  'utf8',
)

describe('admin dispute transcript access', () => {
  it('requires staff and proves a dispute exists before reading messages', () => {
    expect(route).toContain("['admin', 'super_admin'].includes(session.role)")
    expect(route).toContain(".from('disputes')")
    expect(route).toContain(".eq('order_id', id)")
  })

  it('is read-only and includes archived rider assignments', () => {
    expect(route).toContain(".from('order_conversations')")
    expect(route).not.toMatch(/export async function (POST|PATCH|DELETE)/)
    expect(route).not.toContain(".eq('is_active', true)")
    expect(route).toContain(".order('assignment_version'")
  })

  it('limits direct RLS admin reads to orders with disputes', () => {
    expect(migration).toMatch(/EXISTS \(\s*SELECT 1 FROM disputes/i)
    expect(migration).toMatch(/FROM admins[\s\S]*auth\.jwt\(\)/i)
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
  })
})
