import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

let db: PGlite

async function rejects(sql: string): Promise<boolean> {
  try {
    await db.exec(sql)
    return false
  } catch {
    return true
  }
}

describe('promotion fund database enforcement', () => {
  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE vendors (id UUID PRIMARY KEY);
      CREATE TABLE cities (id UUID PRIMARY KEY);
      CREATE TABLE customers (id UUID PRIMARY KEY);
      CREATE TABLE settings (id TEXT PRIMARY KEY, value JSONB NOT NULL);
      CREATE TABLE orders (
        id UUID PRIMARY KEY,
        customer_id UUID REFERENCES customers(id),
        payment_status TEXT NOT NULL DEFAULT 'PENDING'
      );
    `)
    await db.exec(readFileSync(
      join(process.cwd(), 'supabase/migrations/151_promotions_promo_fund_and_virtual_accounts.sql'),
      'utf8',
    ))
    await db.exec(`
      INSERT INTO vendors(id) VALUES ('00000000-0000-0000-0000-000000000001');
      INSERT INTO customers(id) VALUES ('00000000-0000-0000-0000-000000000002');
      INSERT INTO orders(id, customer_id) VALUES
        ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002'),
        ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002');
    `)
  }, 30_000)

  it('grants service_role access while keeping credits append-only and idempotent', async () => {
    await db.exec(`
      SET ROLE service_role;
      SELECT recharge_promo_fund(100, 'credit:test:1', 'provider-1', 'Launch credit', 'admin-1', 'admin', FALSE);
      SELECT recharge_promo_fund(100, 'credit:test:1', 'provider-1', 'Launch credit', 'admin-1', 'admin', FALSE);
      RESET ROLE;
    `)
    const count = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM promo_fund_ledger')
    expect(count.rows[0].count).toBe(1)
    expect(await rejects(`UPDATE promo_fund_ledger SET amount_kobo = 200`)).toBe(true)
    expect(await rejects(`
      SELECT recharge_promo_fund(200, 'credit:test:1', 'provider-1', 'Different credit', 'admin-1', 'admin', FALSE)
    `)).toBe(true)
  })

  it('requires a vendor for vendor funding and caps its discount to the vendor settlement', async () => {
    expect(await rejects(`
      INSERT INTO promotions(
        code, discount_type, value_kobo, funding_source, starts_at, created_by
      ) VALUES ('BADVENDOR', 'FIXED', 5000, 'VENDOR', now() - interval '1 minute', 'admin-1')
    `)).toBe(true)

    await db.exec(`
      INSERT INTO promotions(
        code, discount_type, value_kobo, eligible_vendor_id, funding_source,
        starts_at, status, created_by
      ) VALUES (
        'VENDOR5000', 'FIXED', 5000, '00000000-0000-0000-0000-000000000001',
        'VENDOR', now() - interval '1 minute', 'ACTIVE', 'admin-1'
      )
    `)
    const reserved = await db.query<{ discount_kobo: number }>(`
      SELECT reserved.discount_kobo::int
      FROM reserve_launch_promotion(
        'VENDOR5000',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000001',
        NULL, NULL, 10000, 1000, 500, 3000, FALSE,
        'reserve:vendor:1', now() + interval '30 minutes'
      ) AS reserved
    `)
    expect(reserved.rows[0].discount_kobo).toBe(3000)
    const reserves = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM promo_fund_ledger WHERE entry_type = 'RESERVE'`,
    )
    expect(reserves.rows[0].count).toBe(0)
  })

  it('rejects a LumeX reservation when available promo funds are insufficient', async () => {
    await db.exec(`
      INSERT INTO promotions(
        code, discount_type, value_kobo, funding_source, starts_at, status, created_by
      ) VALUES ('LUMEX500', 'FIXED', 500, 'LUMEX', now() - interval '1 minute', 'ACTIVE', 'admin-1')
    `)
    expect(await rejects(`
      SELECT * FROM reserve_launch_promotion(
        'LUMEX500',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000001',
        NULL, NULL, 10000, 1000, 500, 9000, FALSE,
        'reserve:lumex:1', now() + interval '30 minutes'
      )
    `)).toBe(true)
  })
})
