import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type ChainGap = { broken_id: number; reason: string }

describe('security event evidence integrity in PostgreSQL', () => {
  let db: PGlite
  let legacyId: number
  let protectedId: number

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
      -- PGlite does not bundle pgcrypto. This deterministic bytea stand-in lets
      -- us exercise the trigger/verifier control flow; production PostgreSQL
      -- supplies the real pgcrypto sha256 implementation.
      CREATE FUNCTION public.sha256(input bytea) RETURNS bytea
        LANGUAGE sql IMMUTABLE AS $$ SELECT decode(md5(input), 'hex') $$;
    `)

    const migrations = join(process.cwd(), 'supabase', 'migrations')
    await db.exec(readFileSync(join(migrations, '085_security_events.sql'), 'utf8'))
    const legacy = await db.query<{ id: number }>(`
      INSERT INTO security_events
        (event_type, severity, surface, session_id, ip, user_agent, detail)
      VALUES
        ('auth_fail', 'warn', 'legacy', 'legacy-session', '192.0.2.1', 'legacy-agent', '{}')
      RETURNING id
    `)
    legacyId = legacy.rows[0].id

    await db.exec(readFileSync(join(migrations, '133_security_event_request_integrity.sql'), 'utf8'))
    const protectedRow = await db.query<{ id: number }>(`
      INSERT INTO security_events
        (event_type, severity, surface, session_id, ip, user_agent,
         request_id, correlation_id, route, method, resource_type, resource_id, outcome, detail)
      VALUES
        ('authz_deny', 'warn', 'orders', 'protected-session', '198.51.100.8', 'agent',
         'request-1', 'correlation-1', '/api/orders/1', 'POST', 'order', '1', 'denied', '{}')
      RETURNING id
    `)
    protectedId = protectedRow.rows[0].id
  }, 120_000)

  afterAll(async () => {
    await db.close()
  }, 30_000)

  it('verifies legacy v1 and new v2 rows together', async () => {
    expect(legacyId).toBeGreaterThan(0)
    expect(protectedId).toBeGreaterThan(legacyId)
    const result = await db.query<ChainGap>('SELECT * FROM security_events_verify_chain()')
    expect(result.rows).toEqual([])
  })

  it('detects tampering with metadata omitted by the legacy hash', async () => {
    await db.exec(`
      ALTER TABLE security_events DISABLE TRIGGER trg_security_events_no_mutate;
      UPDATE security_events SET session_id = 'tampered', ip = '203.0.113.9' WHERE id = ${protectedId};
      ALTER TABLE security_events ENABLE TRIGGER trg_security_events_no_mutate;
    `)
    const result = await db.query<ChainGap>('SELECT * FROM security_events_verify_chain()')
    expect(result.rows).toHaveLength(1)
    expect(Number(result.rows[0].broken_id)).toBe(protectedId)
    expect(result.rows[0].reason).toMatch(/integrity payload mismatch/i)
  })
})
