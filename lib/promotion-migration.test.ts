import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/151_promotions_promo_fund_and_virtual_accounts.sql'), 'utf8')
describe('promotion fund database invariants', () => {
  it('serializes concurrent reservations and rejects insufficient funds', () => { expect(sql).toMatch(/FOR UPDATE/);expect(sql).toMatch(/LOCK TABLE promo_fund_ledger/);expect(sql).toMatch(/insufficient promo funds/) })
  it('commits successful payment and releases failed or expired payment idempotently', () => {
    expect(sql).toMatch(/Confirmed order payment/);expect(sql).toMatch(/Failed payment/);expect(sql).toMatch(/release_expired_promo_reservations/);expect(sql).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/)
  })
  it('does not debit the LumeX fund for vendor-funded discounts', () => expect(sql).toMatch(/IF p\.funding_source = 'LUMEX' THEN/))
  it('requires elevated authorization for immutable reconciled credits', () => { expect(sql).toMatch(/RECONCILED_CREDIT/);expect(sql).toMatch(/p_actor_role <> 'super_admin'/);expect(sql).not.toMatch(/UPDATE promo_fund_ledger/) })
  it('records receipts without creating a customer balance', () => { expect(sql).toMatch(/virtual_account_receipts/);expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_wallet/) })
})
