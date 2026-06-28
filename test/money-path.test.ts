import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #3 — money-path integrity (migration 086).
//
// CI hosts no Postgres (the suite mocks the DB), so live INSERT-raises and the
// escrow release/no-release are proven by scripts/verify-086.sql (run in
// Supabase). These static checks lock in the migration's SHAPE so a future edit
// can't silently weaken it — most importantly the per-table predicate (the trap
// is that platform_earnings / customer_wallet_transactions are SIGNED, so they
// must be `<> 0`, never `> 0`).
// ════════════════════════════════════════════════════════════════════════════

const dir = join(process.cwd(), 'supabase', 'migrations')
const file = readdirSync(dir).find((f) => f.startsWith('086_'))
const sql = file ? readFileSync(join(dir, file), 'utf8') : ''
// Collapse whitespace so multi-line ALTERs match on a single regex.
const flat = sql.replace(/\s+/g, ' ')

describe('migration 086 — money-path integrity', () => {
  it('exists', () => { expect(file, 'migration 086 must exist').toBeTruthy() })

  it('ships all four amount CHECKs as NOT VALID', () => {
    expect(flat).toMatch(/CONSTRAINT wallet_tx_amount_nonzero CHECK \(amount <> 0\) NOT VALID/i)
    expect(flat).toMatch(/CONSTRAINT cwt_amount_nonzero CHECK \(amount_kobo <> 0\) NOT VALID/i)
    expect(flat).toMatch(/CONSTRAINT pe_amount_nonzero CHECK \(amount_kobo <> 0\) NOT VALID/i)
    expect(flat).toMatch(/CONSTRAINT refunds_amount_positive CHECK \(amount_kobo > 0\) NOT VALID/i)
    // Exactly four NOT VALID *constraint definitions* (ignores comment prose) —
    // no accidental VALIDATE-on-apply.
    expect((flat.match(/CHECK \([^)]*\) NOT VALID/g) ?? []).length).toBe(4)
  })

  it('uses the SIGNED-safe predicate (<> 0) on the signed ledgers, not > 0', () => {
    // The trap: a blanket "> 0" would corrupt platform_earnings (costs are
    // negative) and customer_wallet_transactions (ADMIN_ADJUSTMENT debits).
    expect(flat).not.toMatch(/pe_amount_nonzero CHECK \(amount_kobo > 0\)/i)
    expect(flat).not.toMatch(/cwt_amount_nonzero CHECK \(amount_kobo > 0\)/i)
  })

  it('adds the platform_earnings idempotency index, apply-safe on legacy dupes', () => {
    expect(flat).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_earnings_order_type ON platform_earnings \(order_id, type\) WHERE order_id IS NOT NULL/i)
    // Wrapped so existing duplicates WARN instead of aborting the migration.
    expect(flat).toMatch(/EXCEPTION WHEN unique_violation THEN/i)
  })

  it('gates escrow release on a server-confirmed order status', () => {
    expect(flat).toMatch(/CREATE OR REPLACE FUNCTION release_held_batch/i)
    // The status gate + the text-cast that matches orders.id.
    expect(flat).toMatch(/o\.id::text = wt\.order_id/i)
    expect(flat).toMatch(/o\.status IN \('DELIVERED', 'COMPLETED'\)/i)
    // Non-order holds keep their timer behaviour (no funds trapped).
    expect(flat).toMatch(/wt\.order_id IS NULL/i)
    // Preserves the 075 lot-opening (didn't regress the sweep clock).
    expect(flat).toMatch(/INSERT INTO wallet_payout_lots/i)
  })

  it('documents the audit-before-VALIDATE queries (decision: NOT VALID now)', () => {
    expect(sql).toMatch(/VALIDATE CONSTRAINT wallet_tx_amount_nonzero/i)
    expect(sql).toMatch(/WHERE amount = 0/i)
  })
})
