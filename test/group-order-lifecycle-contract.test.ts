import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/147_group_order_lifecycle.sql', 'utf8')
const itemsRoute = readFileSync('app/api/group-order/[code]/items/route.ts', 'utf8')
const orderRoute = readFileSync('app/api/orders/route.ts', 'utf8')
const joinRoute = readFileSync('app/api/group-order/[code]/join/route.ts', 'utf8')
const participantSession = readFileSync('lib/group-participant-session.ts', 'utf8')

describe('group-order lifecycle contract', () => {
  it('uses one explicit terminal-safe state model', () => {
    for (const state of ['DRAFT', 'OPEN', 'LOCKED', 'VALIDATING', 'AWAITING_PAYMENT', 'PLACED', 'CANCELLED', 'EXPIRED', 'FAILED']) {
      expect(migration).toContain(`'${state}'`)
    }
    expect(migration).toContain("UPDATE group_orders SET status = 'PLACED' WHERE status = 'CHECKED_OUT'")
  })

  it('serializes participant writes against organizer locking', () => {
    expect(migration).toContain('group_order_add_item_atomic')
    expect(migration).toContain('group_order_update_item_atomic')
    expect(migration).toContain('group_order_delete_item_atomic')
    expect(migration.match(/FROM group_orders WHERE id = p_group_id FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(4)
    expect(itemsRoute).toContain("db.rpc('group_order_add_item_atomic'")
    expect(itemsRoute).toContain("db.rpc('group_order_update_item_atomic'")
  })

  it('supports scoped guest participants without anonymous final placement', () => {
    expect(migration).toContain('guest_session_hash TEXT')
    expect(joinRoute).toContain('hashGroupParticipantToken')
    expect(participantSession).toContain('httpOnly: true')
    expect(orderRoute).toContain('Organizer authentication is required for group checkout.')
  })

  it('keeps final placement organizer-paid and exact to reconciled contributions', () => {
    expect(orderRoute).toContain('const groupSplitEnabled = false')
    expect(orderRoute).toContain("g.status !== 'AWAITING_PAYMENT'")
    expect(orderRoute).toContain('Group contributions changed.')
  })
})
