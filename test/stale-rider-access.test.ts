import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('stale and reassigned rider access', () => {
  const accept = read('app/api/riders/[id]/accept/route.ts')
  const status = read('app/api/orders/[id]/status/route.ts')
  const deliver = read('app/api/orders/[id]/deliver/route.ts')
  const photo = read('app/api/orders/[id]/delivery-photo/route.ts')
  const migration = read('supabase/migrations/137_atomic_rider_assignment.sql')

  it('assigns order and rider state in one locked transaction', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION accept_rider_order/i)
    expect(migration).toMatch(/FROM riders[\s\S]*FOR UPDATE/i)
    expect(migration).toMatch(/FROM orders[\s\S]*FOR UPDATE/i)
    expect(migration).toMatch(/status = 'READY' AND rider_id IS NULL/i)
    expect(migration).toMatch(/UPDATE riders SET status = 'BUSY', active_order_id = p_order_id/i)
    expect(accept).toMatch(/db\.rpc\('accept_rider_order'/i)
    expect(accept).not.toMatch(/db\.from\('riders'\)\.update\(\{[\s\S]*active_order_id/i)
  })

  it('rechecks rider assignment in the same delivery/status mutation', () => {
    expect(deliver).toMatch(/claimQuery = claimQuery\.eq\('rider_id', session\.userId!/i)
    expect(status).toMatch(/updateQuery = updateQuery\.eq\('rider_id', session\.userId!/i)
    expect(deliver).toMatch(/outcome: 'claim_lost'/i)
    expect(status).toMatch(/'reassigned_during_request'/i)
    expect(migration).toMatch(/FUNCTION bump_assigned_rider_handover_attempts/i)
    expect(migration).toMatch(/rider_id = p_rider_id AND status = 'PICKED_UP' FOR UPDATE/i)
    expect(deliver).toMatch(/reassigned_before_wrong_code_count/i)
  })

  it('does not attach an uploaded proof after reassignment', () => {
    expect(photo).toMatch(/updateQuery = updateQuery\.eq\('rider_id', session\.userId!/i)
    expect(photo).toMatch(/\.in\('status', \['RIDER_ASSIGNED', 'PICKED_UP'\]\)/i)
    expect(photo).toMatch(/remove\(\[path\]\)/i)
    expect(photo).toMatch(/outcome: 'reassigned_during_upload'/i)
  })

  it('records request-correlated stale access without exposing handover secrets', () => {
    for (const route of [accept, status, deliver, photo]) {
      expect(route).toMatch(/requestId: context\.requestId/i)
      expect(route).toMatch(/correlationId: context\.correlationId/i)
    }
    expect(deliver).not.toMatch(/detail:\s*\{[^}]*rawCode/i)
  })
})
