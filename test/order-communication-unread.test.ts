import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '125_order_communication_unread.sql'),
  'utf8',
)
const route = readFileSync(
  join(process.cwd(), 'app', 'api', 'order-communications', 'unread', 'route.ts'),
  'utf8',
)

describe('order communication unread counts', () => {
  it('counts only unread user messages from another participant', () => {
    expect(migration).toContain("m.message_type = 'USER'")
    expect(migration).toContain('m.sender_id IS DISTINCT FROM p_participant_id')
    expect(migration).toContain("m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)")
  })

  it('binds all roles to the current active rider assignment', () => {
    expect(migration).toContain('o.rider_id = oc.rider_id')
    expect(migration).toContain('WHERE oc.is_active')
    expect(migration).toContain("p_participant_type = 'CUSTOMER'")
    expect(migration).toContain("p_participant_type = 'VENDOR'")
    expect(migration).toContain("p_participant_type = 'RIDER'")
  })

  it('keeps the aggregate service-role only and app-session gated', () => {
    expect(migration).toMatch(/REVOKE ALL[\s\S]*PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*service_role/i)
    expect(route).toContain('getCurrentUser()')
    expect(route).toContain('session.userId')
  })
})
