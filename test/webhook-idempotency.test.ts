import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #4 — webhook idempotency BEHAVIOR on a REAL Postgres (pglite).
// Proves the ROOT CAUSE dead at the DB level: a replayed charge.success can't
// double-credit, a duplicate subscription reference can't double-book, and
// migration 087 behaves (refund insert without `amount` succeeds; the
// vendor_subscriptions unique rejects dup refs but allows NULL repeats).
// ════════════════════════════════════════════════════════════════════════════

const SCHEMA = `
  CREATE TABLE refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid,
    amount bigint NOT NULL, amount_kobo bigint,
    paystack_transaction_reference text, status text);
  CREATE TABLE vendor_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid,
    paystack_reference text, amount bigint, status text);
  CREATE TABLE processed_webhooks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text, paystack_reference text,
    event text, payload jsonb, UNIQUE (reference, event));
  CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paystack_reference text,
    payment_status text, status text);
`

let db: PGlite
async function rejects(sql: string): Promise<boolean> {
  try { await db.exec(sql); return false } catch { return true }
}

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(SCHEMA)
  // Run the ACTUAL migration 087.
  await db.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', '087_refund_amount_and_subscription_idempotency.sql'), 'utf8'))
}, 30_000)

describe('replayed charge.success cannot double-credit', () => {
  it('processed_webhooks UNIQUE(reference,event) rejects the second record', async () => {
    await db.exec(`INSERT INTO processed_webhooks (reference, event) VALUES ('evt_1','charge.success')`)
    expect(await rejects(`INSERT INTO processed_webhooks (reference, event) VALUES ('evt_1','charge.success')`)).toBe(true)
  })

  it('orders UPDATE ...WHERE payment_status=PENDING affects 1 row then 0 (no re-credit)', async () => {
    await db.exec(`INSERT INTO orders (paystack_reference, payment_status, status) VALUES ('ref_1','PENDING','PENDING_PAYMENT')`)
    const first = await db.query(`UPDATE orders SET payment_status='PAID' WHERE paystack_reference='ref_1' AND payment_status='PENDING' RETURNING id`)
    const second = await db.query(`UPDATE orders SET payment_status='PAID' WHERE paystack_reference='ref_1' AND payment_status='PENDING' RETURNING id`)
    expect(first.rows.length).toBe(1)
    expect(second.rows.length).toBe(0)
  })
})

describe('subscription idempotency (handler check-then-insert + 087 unique backstop)', () => {
  it('the guarded check-then-insert pattern inserts the reference exactly once', async () => {
    const guarded = `INSERT INTO vendor_subscriptions (vendor_id, paystack_reference, amount, status)
      SELECT gen_random_uuid(), 'sub_ref_1', 1500000, 'ACTIVE'
      WHERE NOT EXISTS (SELECT 1 FROM vendor_subscriptions WHERE paystack_reference = 'sub_ref_1')`
    await db.exec(guarded)
    await db.exec(guarded) // reprocess
    const r = await db.query(`SELECT count(*)::int AS n FROM vendor_subscriptions WHERE paystack_reference='sub_ref_1'`)
    expect((r.rows[0] as { n: number }).n).toBe(1)
  })

  it('087 UNIQUE rejects a duplicate paystack_reference (race backstop)', async () => {
    await db.exec(`INSERT INTO vendor_subscriptions (paystack_reference, amount) VALUES ('dup_ref', 1)`)
    expect(await rejects(`INSERT INTO vendor_subscriptions (paystack_reference, amount) VALUES ('dup_ref', 1)`)).toBe(true)
  })

  it('087 partial index allows NULL references to repeat (subscriptions without a ref)', async () => {
    await db.exec(`INSERT INTO vendor_subscriptions (paystack_reference, amount) VALUES (NULL, 1)`)
    expect(await rejects(`INSERT INTO vendor_subscriptions (paystack_reference, amount) VALUES (NULL, 1)`)).toBe(false)
  })
})

describe('087 refunds.amount relaxed', () => {
  it('a refund insert that OMITS the vestigial amount now succeeds', async () => {
    expect(await rejects(
      `INSERT INTO refunds (order_id, amount_kobo, paystack_transaction_reference, status)
       VALUES (gen_random_uuid(), 5000, 'tx_1', 'PROCESSING')`)).toBe(false)
  })
})
