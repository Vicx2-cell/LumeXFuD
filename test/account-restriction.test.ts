import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCOUNT_RESTRICTION_MESSAGE } from '@/lib/account-restriction'

describe('account restriction session revocation', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE TABLE customers (id uuid PRIMARY KEY, suspended_until timestamptz);
      CREATE TABLE vendors (id uuid PRIMARY KEY, suspended_until timestamptz);
      CREATE TABLE riders (id uuid PRIMARY KEY, suspended_until timestamptz);
      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        user_id text NOT NULL,
        revoked_at timestamptz
      );
    `)
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '134_restriction_session_revocation.sql'),
      'utf8',
    )
    await db.exec(sql)
  }, 60_000)

  afterAll(async () => {
    await db.close()
  }, 30_000)

  it.each([
    ['customers', '00000000-0000-4000-8000-000000000001'],
    ['vendors', '00000000-0000-4000-8000-000000000002'],
    ['riders', '00000000-0000-4000-8000-000000000003'],
  ])('revokes every active %s session in the same update', async (table, userId) => {
    await db.exec(`
      INSERT INTO ${table} (id) VALUES ('${userId}');
      INSERT INTO sessions (id, user_id) VALUES
        (gen_random_uuid(), '${userId}'),
        (gen_random_uuid(), '${userId}');
      UPDATE ${table} SET suspended_until = '2099-01-01T00:00:00Z' WHERE id = '${userId}';
    `)
    const result = await db.query<{ active: number; revoked: number }>(`
      SELECT
        count(*) FILTER (WHERE revoked_at IS NULL)::int AS active,
        count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
      FROM sessions WHERE user_id = '${userId}'
    `)
    expect(result.rows[0]).toEqual({ active: 0, revoked: 2 })
  })

  it('lifting a restriction never revives revoked sessions', async () => {
    const userId = '00000000-0000-4000-8000-000000000001'
    await db.exec(`UPDATE customers SET suspended_until = NULL WHERE id = '${userId}'`)
    const result = await db.query<{ active: number }>(`
      SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active
      FROM sessions WHERE user_id = '${userId}'
    `)
    expect(result.rows[0].active).toBe(0)
  })
})

describe('generic user-facing restriction message', () => {
  it('contains no investigative reason, device, fingerprint, or location detail', () => {
    expect(ACCOUNT_RESTRICTION_MESSAGE).toMatch(/temporarily restricted/i)
    expect(ACCOUNT_RESTRICTION_MESSAGE).toMatch(/contact support/i)
    expect(ACCOUNT_RESTRICTION_MESSAGE).not.toMatch(/device|fingerprint|location|ip address|linked account|rule|score/i)
  })

  it('is reused by every current user-facing restriction path', () => {
    const files = [
      'app/api/auth/login/route.ts',
      'app/api/auth/social/complete/route.ts',
      'app/api/orders/route.ts',
      'lib/whatsapp-handler.ts',
    ]
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).toContain('ACCOUNT_RESTRICTION_MESSAGE')
      expect(source, file).not.toContain('suspend_reason')
    }
  })
})
