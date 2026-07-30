import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type JournalResult = { journal_id: string; replayed: boolean; journal_status: string }
type SnapshotResult = { snapshot_id: string; replayed: boolean }
type ReservationResult = { reservation_id: string; journal_id: string; replayed: boolean; status: string }

let db: PGlite

async function rejects(sql: string): Promise<boolean> {
  try {
    await db.exec(sql)
    return false
  } catch {
    return true
  }
}

async function withServiceRole<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('SET ROLE service_role;')
  try {
    return await fn()
  } finally {
    await db.exec('RESET ROLE;')
  }
}

describe('payments ledger foundation', () => {
  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
      CREATE TABLE customers (id UUID PRIMARY KEY);
      CREATE TABLE vendors (id UUID PRIMARY KEY);
      CREATE TABLE riders (id UUID PRIMARY KEY);
      CREATE TABLE cities (id UUID PRIMARY KEY);
      CREATE TABLE orders (
        id UUID PRIMARY KEY,
        customer_id UUID REFERENCES customers(id),
        vendor_id UUID REFERENCES vendors(id),
        rider_id UUID REFERENCES riders(id),
        zone_id UUID REFERENCES cities(id),
        delivery_type TEXT NOT NULL DEFAULT 'DOOR'
      );
    `)

    await db.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', '158_payments_ledger_foundation.sql'), 'utf8'))
    await db.exec(`
      INSERT INTO customers (id) VALUES ('00000000-0000-0000-0000-000000000001');
      INSERT INTO vendors (id) VALUES ('00000000-0000-0000-0000-000000000002');
      INSERT INTO riders (id) VALUES ('00000000-0000-0000-0000-000000000003');
      INSERT INTO cities (id) VALUES ('00000000-0000-0000-0000-000000000004');
      INSERT INTO orders (id, customer_id, vendor_id, rider_id, zone_id, delivery_type)
      VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'DOOR');
      INSERT INTO orders (id, customer_id, vendor_id, rider_id, zone_id, delivery_type)
      VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'DOOR');
      INSERT INTO orders (id, customer_id, vendor_id, rider_id, zone_id, delivery_type)
      VALUES ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'DOOR');
    `)
  }, 120_000)

  it('creates active accounts and posts a balanced journal exactly once', async () => {
    const result = await withServiceRole(async () => {
      const accounts = await db.query<{ available_id: string; reserved_id: string; clearing_id: string }>(`
        SELECT
          ensure_financial_account('CUSTOMER_AVAILABLE', 'CUSTOMER', '00000000-0000-0000-0000-000000000001', 'NGN', 'production', '{}'::jsonb) AS available_id,
          ensure_financial_account('CUSTOMER_RESERVED', 'CUSTOMER', '00000000-0000-0000-0000-000000000001', 'NGN', 'production', '{}'::jsonb) AS reserved_id,
          ensure_financial_account('COLLECTION_CLEARING', 'PLATFORM', NULL, 'NGN', 'production', '{}'::jsonb) AS clearing_id
      `)
      const availableId = accounts.rows[0].available_id
      const reservedId = accounts.rows[0].reserved_id
      const clearingId = accounts.rows[0].clearing_id

      const first = await db.query<JournalResult>(`
        SELECT * FROM post_ledger_journal(
          'DVA_DEPOSIT',
          'deposit-1',
          'ledger:test:deposit-1',
          'NGN',
          'webhook',
          'system',
          NULL,
          'corr-1',
          jsonb_build_object('environment', 'production'),
          NULL,
          jsonb_build_array(
            jsonb_build_object('account_id', '${clearingId}', 'side', 'DEBIT', 'amount_kobo', 5000),
            jsonb_build_object('account_id', '${availableId}', 'side', 'CREDIT', 'amount_kobo', 5000)
          )
        )
      `)
      const second = await db.query<JournalResult>(`
        SELECT * FROM post_ledger_journal(
          'DVA_DEPOSIT',
          'deposit-1',
          'ledger:test:deposit-1',
          'NGN',
          'webhook',
          'system',
          NULL,
          'corr-1',
          jsonb_build_object('environment', 'production'),
          NULL,
          jsonb_build_array(
            jsonb_build_object('account_id', '${clearingId}', 'side', 'DEBIT', 'amount_kobo', 5000),
            jsonb_build_object('account_id', '${availableId}', 'side', 'CREDIT', 'amount_kobo', 5000)
          )
        )
      `)

      const journalCount = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM ledger_journals')
      const entryCount = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM ledger_entries')
      const balances = await db.query<{ available: number; reserved: number }>(`
        SELECT
          financial_account_balance('${availableId}')::int AS available,
          financial_account_balance('${reservedId}')::int AS reserved
      `)

      return {
        first: first.rows[0],
        second: second.rows[0],
        journalCount: journalCount.rows[0].count,
        entryCount: entryCount.rows[0].count,
        balances: balances.rows[0],
      }
    })

    expect(result.first.replayed).toBe(false)
    expect(result.second.replayed).toBe(true)
    expect(result.first.journal_id).toBe(result.second.journal_id)
    expect(result.journalCount).toBe(1)
    expect(result.entryCount).toBe(2)
    expect(result.balances.available).toBe(5000)
    expect(result.balances.reserved).toBe(0)
  })

  it('rejects unbalanced journals and keeps posted rows immutable', async () => {
    expect(await rejects(`
      SET ROLE service_role;
      SELECT * FROM post_ledger_journal(
        'BROKEN',
        'deposit-2',
        'ledger:test:deposit-2',
        'NGN',
        'webhook',
        'system',
        NULL,
        NULL,
        '{}'::jsonb,
        NULL,
        jsonb_build_array(
          jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000001', 'side', 'DEBIT', 'amount_kobo', 1000),
          jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000001', 'side', 'CREDIT', 'amount_kobo', 999)
        )
      );
      RESET ROLE;
    `)).toBe(true)

    expect(await rejects(`UPDATE ledger_entries SET amount_kobo = 1`)).toBe(true)
    expect(await rejects(`DELETE FROM ledger_journals`)).toBe(true)
  })

  it('records immutable order snapshots with replay-safe idempotency', async () => {
    const result = await withServiceRole(async () => {
      const first = await db.query<SnapshotResult>(`
        SELECT * FROM record_order_financial_snapshot(
          '00000000-0000-0000-0000-000000000005',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000003',
          '00000000-0000-0000-0000-000000000004',
          'DOOR',
          'NGN',
          'pricing-v1',
          'commission-v1',
          10000, 10000, 500, 500, 9500, 1200, 200, 1000, 0, 0, 0, 0, 'NONE', 0, 11200,
          now(),
          'snapshot:test:1',
          '{}'::jsonb
        )
      `)
      const second = await db.query<SnapshotResult>(`
        SELECT * FROM record_order_financial_snapshot(
          '00000000-0000-0000-0000-000000000005',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000003',
          '00000000-0000-0000-0000-000000000004',
          'DOOR',
          'NGN',
          'pricing-v1',
          'commission-v1',
          10000, 10000, 500, 500, 9500, 1200, 200, 1000, 0, 0, 0, 0, 'NONE', 0, 11200,
          now(),
          'snapshot:test:1',
          '{}'::jsonb
        )
      `)
      const count = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM order_financial_snapshots')
      const snapshotId = first.rows[0].snapshot_id
      const snapshotUpdateRejected = await rejects(`
        SET ROLE service_role;
        UPDATE order_financial_snapshots SET total_customer_charge_kobo = 1 WHERE id = '${snapshotId}';
        RESET ROLE;
      `)
      const snapshotDeleteRejected = await rejects(`
        SET ROLE service_role;
        DELETE FROM order_financial_snapshots WHERE id = '${snapshotId}';
        RESET ROLE;
      `)
      return { first: first.rows[0], second: second.rows[0], count: count.rows[0].count, snapshotUpdateRejected, snapshotDeleteRejected }
    })

    expect(result.first.replayed).toBe(false)
    expect(result.second.replayed).toBe(true)
    expect(result.first.snapshot_id).toBe(result.second.snapshot_id)
    expect(result.count).toBe(1)
    expect(result.snapshotUpdateRejected).toBe(true)
    expect(result.snapshotDeleteRejected).toBe(true)
  })

  it('creates, releases, expires, consumes and reverses reservations safely', async () => {
    const result = await withServiceRole(async () => {
      const reservation = await db.query<ReservationResult>(`
        SELECT * FROM reserve_wallet_balance(
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000005',
          2000,
          'NGN',
          'production',
          'reservation:test:1',
          now() + interval '30 minutes',
          'corr-reserve-1',
          '{}'::jsonb
        )
      `)

      const duplicate = await db.query<ReservationResult>(`
        SELECT * FROM reserve_wallet_balance(
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000005',
          2000,
          'NGN',
          'production',
          'reservation:test:1',
          now() + interval '30 minutes',
          'corr-reserve-1',
          '{}'::jsonb
        )
      `)

      const release = await db.query<ReservationResult>(`
        SELECT * FROM release_wallet_reservation(
          '${reservation.rows[0].reservation_id}',
          'customer_cancelled',
          'reservation:release:1',
          'system',
          NULL,
          'corr-release-1',
          '{}'::jsonb
        )
      `)

      const reserve2 = await db.query<ReservationResult>(`
        SELECT * FROM reserve_wallet_balance(
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000006',
          1500,
          'NGN',
          'production',
          'reservation:test:2',
          now() + interval '30 minutes',
          'corr-reserve-2',
          '{}'::jsonb
        )
      `)

      const consume = await db.query<ReservationResult>(`
        SELECT * FROM consume_wallet_reservation(
          '${reserve2.rows[0].reservation_id}',
          'reservation:consume:1',
          'system',
          NULL,
          'corr-consume-1',
          '{}'::jsonb
        )
      `)

      const reserve3 = await db.query<ReservationResult>(`
        SELECT * FROM reserve_wallet_balance(
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000007',
          500,
          'NGN',
          'production',
          'reservation:test:3',
          now() + interval '30 minutes',
          'corr-reserve-3',
          '{}'::jsonb
        )
      `)

      const reverse = await db.query<ReservationResult>(`
        SELECT * FROM reverse_wallet_reservation(
          '${reserve3.rows[0].reservation_id}',
          'reservation:reverse:1',
          'system',
          NULL,
          'corr-reverse-1',
          '{}'::jsonb
        )
      `)

      const balances = await db.query<{ available: number; reserved: number; settlement: number }>(`
        SELECT
          financial_account_balance((SELECT id FROM financial_accounts WHERE account_type='CUSTOMER_AVAILABLE' AND owner_key='customer:00000000-0000-0000-0000-000000000001' AND environment='production'))::int AS available,
          financial_account_balance((SELECT id FROM financial_accounts WHERE account_type='CUSTOMER_RESERVED' AND owner_key='customer:00000000-0000-0000-0000-000000000001' AND environment='production'))::int AS reserved,
          get_pending_settlement_balance('NGN', 'production')::int AS settlement
      `)

      return {
        reservation: reservation.rows[0],
        duplicate: duplicate.rows[0],
        release: release.rows[0],
        consume: consume.rows[0],
        reverse: reverse.rows[0],
        balances: balances.rows[0],
      }
    })

    expect(result.reservation.replayed).toBe(false)
    expect(result.duplicate.replayed).toBe(true)
    expect(result.release.status).toBe('RELEASED')
    expect(result.consume.status).toBe('CONSUMED')
    expect(result.reverse.status).toBe('REVERSED')
    expect(result.balances.available).toBe(5000 - 1500)
    expect(result.balances.reserved).toBe(0)
    expect(result.balances.settlement).toBe(1500)
  })
})
