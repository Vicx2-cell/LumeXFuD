import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #3 — money-path BEHAVIOR tests on a REAL Postgres (pglite).
//
// These are not string matches: a minimal schema is built, the ACTUAL migration
// 086 SQL is executed against it, and then real writes are attempted. A guarded
// write MUST raise; the escrow function MUST release a DELIVERED hold and NOT
// release a CANCELLED/DISPUTED one. This is the proof.
//
// The refunds fixture mirrors the live schema drift: `amount` is NOT NULL (no
// default) and is populated by the fixture — the constraint under test is on
// `amount_kobo`, not the vestigial `amount`.
// ════════════════════════════════════════════════════════════════════════════

const MINIMAL_SCHEMA = `
  CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL);
  CREATE TABLE settings (id text PRIMARY KEY, value jsonb);
  CREATE TABLE wallet_balances (
    user_id text, user_type text, total_balance bigint DEFAULT 0,
    available_balance bigint DEFAULT 0, held_balance bigint DEFAULT 0,
    updated_at timestamptz DEFAULT now(), PRIMARY KEY (user_id, user_type));
  CREATE TABLE wallet_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, user_type text, type text,
    amount bigint NOT NULL, balance_before bigint, balance_after bigint,
    available_before bigint, available_after bigint, held_before bigint, held_after bigint,
    reference text, order_id text, status text DEFAULT 'PENDING', release_at timestamptz,
    description text, created_at timestamptz DEFAULT now());
  CREATE TABLE customer_wallet_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, type text,
    amount_kobo bigint NOT NULL, balance_before_kobo bigint, balance_after_kobo bigint, description text);
  CREATE TABLE platform_earnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, type text,
    amount_kobo bigint NOT NULL, description text, created_at timestamptz DEFAULT now());
  -- Mirror live drift: legacy amount column is NOT NULL with no default.
  CREATE TABLE refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, amount bigint NOT NULL,
    amount_kobo bigint NOT NULL, reason text, status text, triggered_by text);
  CREATE TABLE wallet_payout_lots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, user_type text, amount bigint,
    remaining bigint, withdrawable_at timestamptz, sweep_due_at timestamptz, state text,
    release_tx_id uuid, order_id text);
`

const DELIVERED = '11111111-1111-1111-1111-111111111111'
const CANCELLED = '22222222-2222-2222-2222-222222222222'

let db: PGlite

async function rejects(sql: string): Promise<boolean> {
  try { await db.exec(sql); return false } catch { return true }
}

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(MINIMAL_SCHEMA)
  // Execute the REAL migration 086 against the minimal schema.
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '086_money_path_integrity.sql'), 'utf8')
  await db.exec(sql)
  await db.exec(`INSERT INTO customers (id) VALUES (gen_random_uuid())`)
  await db.exec(`INSERT INTO orders (id, status) VALUES ('${DELIVERED}','DELIVERED'), ('${CANCELLED}','CANCELLED')`)
}, 30_000)

describe('amount integrity — a zero-amount write RAISES (NOT VALID enforces new writes)', () => {
  it('wallet_transactions rejects amount = 0', async () => {
    expect(await rejects(
      `INSERT INTO wallet_transactions (user_id,user_type,type,amount,balance_before,balance_after)
       VALUES ('u','VENDOR','CREDIT',0,0,0)`)).toBe(true)
  })
  it('customer_wallet_transactions rejects amount_kobo = 0', async () => {
    expect(await rejects(
      `INSERT INTO customer_wallet_transactions (customer_id,type,amount_kobo,balance_before_kobo,balance_after_kobo,description)
       VALUES ((SELECT id FROM customers LIMIT 1),'TOPUP',0,0,0,'x')`)).toBe(true)
  })
  it('platform_earnings rejects amount_kobo = 0', async () => {
    expect(await rejects(
      `INSERT INTO platform_earnings (order_id,type,amount_kobo) VALUES (NULL,'FOOD_MARKUP',0)`)).toBe(true)
  })
  it('refunds rejects amount_kobo = 0 (vestigial amount populated)', async () => {
    expect(await rejects(
      `INSERT INTO refunds (order_id,amount,amount_kobo,reason,status,triggered_by)
       VALUES ('${DELIVERED}',100,0,'x','PROCESSING','test')`)).toBe(true)
  })
  it('a NON-zero / signed write is ACCEPTED (no false positives)', async () => {
    // platform_earnings cost rows are negative — must be allowed.
    expect(await rejects(
      `INSERT INTO platform_earnings (order_id,type,amount_kobo) VALUES (NULL,'REFUND_COST',-500)`)).toBe(false)
  })
})

describe('platform_earnings idempotency — duplicate (order_id,type) REJECTED', () => {
  it('second insert of the same (order_id,type) raises', async () => {
    await db.exec(`INSERT INTO platform_earnings (order_id,type,amount_kobo) VALUES ('${DELIVERED}','DELIVERY_CUT',100)`)
    expect(await rejects(
      `INSERT INTO platform_earnings (order_id,type,amount_kobo) VALUES ('${DELIVERED}','DELIVERY_CUT',100)`)).toBe(true)
  })
  it('NULL order_id rows are NOT constrained (subscriptions/top-ups can repeat)', async () => {
    await db.exec(`INSERT INTO platform_earnings (order_id,type,amount_kobo) VALUES (NULL,'VENDOR_SUBSCRIPTION',1500000)`)
    expect(await rejects(
      `INSERT INTO platform_earnings (order_id,type,amount_kobo) VALUES (NULL,'VENDOR_SUBSCRIPTION',1500000)`)).toBe(false)
  })
})

describe('escrow gate — release only on server-confirmed delivery', () => {
  beforeAll(async () => {
    await db.exec(`INSERT INTO wallet_balances (user_id,user_type,total_balance,available_balance,held_balance)
                   VALUES ('rider','RIDER',2000,0,2000)`)
    await db.exec(`
      INSERT INTO wallet_transactions (user_id,user_type,type,amount,balance_before,balance_after,
        available_before,available_after,held_before,held_after,reference,order_id,status,release_at)
      VALUES
       ('rider','RIDER','HOLD',1000,2000,2000,0,0,0,1000,'hold-del','${DELIVERED}','PENDING', now()-interval '1 hour'),
       ('rider','RIDER','HOLD',1000,2000,2000,0,0,1000,2000,'hold-bad','${CANCELLED}','PENDING', now()-interval '1 hour')`)
    await db.query(`SELECT release_held_batch()`)
  })

  it('(a) HOLD on a DELIVERED order DOES release (text-cast matched a real order)', async () => {
    const r = await db.query<{ status: string }>(`SELECT status FROM wallet_transactions WHERE reference='hold-del'`)
    expect(r.rows[0].status).toBe('COMPLETED')
  })
  it('(b) HOLD on a CANCELLED order does NOT release (funds stay held)', async () => {
    const r = await db.query<{ status: string }>(`SELECT status FROM wallet_transactions WHERE reference='hold-bad'`)
    expect(r.rows[0].status).toBe('PENDING')
  })
  it('the delivered release actually moved held → available on the balance', async () => {
    const r = await db.query<{ available_balance: number; held_balance: number }>(
      `SELECT available_balance, held_balance FROM wallet_balances WHERE user_id='rider'`)
    expect(Number(r.rows[0].available_balance)).toBe(1000) // the delivered hold released
    expect(Number(r.rows[0].held_balance)).toBe(1000)      // the cancelled hold stayed held
  })
})
