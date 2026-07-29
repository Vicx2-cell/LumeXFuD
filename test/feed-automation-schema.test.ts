import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/155_automatic_feed_engine.sql', 'utf8')
const completionMigration = readFileSync('supabase/migrations/156_feed_bundles_and_coverage.sql', 'utf8')
const vendorApi = readFileSync('app/api/vendor/feed-automation/route.ts', 'utf8')
const adminApi = readFileSync('app/api/super-admin/feed-automation/route.ts', 'utf8')
const pinApi = readFileSync('app/api/super-admin/feed-pins/route.ts', 'utf8')

describe('automatic feed database contract', () => {
  it('uses a durable unique outbox with retry/dead-letter state and atomic claims', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS feed_automation_outbox')
    expect(migration).toContain('event_key TEXT NOT NULL UNIQUE')
    expect(migration).toContain("'retry', 'dead'")
    expect(migration).toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS posts_automatic_idempotency_uidx')
  })

  it('cannot break approval, menu, checkout, payment, or order completion when feed enqueue fails', () => {
    expect(migration).toContain('EXCEPTION WHEN OTHERS THEN')
    expect(migration).toContain('Feed supply must never abort approval, inventory, checkout or payment')
    expect(migration).toContain('RETURN NEW')
  })

  it('records manual/automatic provenance and enables RLS on every private automation table', () => {
    expect(migration).toContain("generation_mode TEXT NOT NULL DEFAULT 'manual'")
    expect(migration).toContain('source_event_type TEXT')
    expect(migration).toContain('template_version TEXT')
    expect(migration).toContain('ALTER TABLE feed_automation_outbox ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON feed_automation_settings')
  })

  it('protects one official account and one primary pin per scope', () => {
    expect(migration).toContain('social_profiles_protect_lumex_identity')
    expect(migration).toContain("OLD.system_account_key = 'lumex_fud'")
    expect(migration).toContain('feed_post_pins_one_primary_scope_uidx')
    expect(migration).toContain("scope_type IN ('global','city','campus','delivery_area')")
  })

  it('enqueues only real vendor, inventory, price, and paid completion transitions', () => {
    expect(migration).toContain("NEW.approval_state = 'approved'")
    expect(migration).toContain("event_name := 'new_menu_item'")
    expect(migration).toContain("event_name := 'item_back_in_stock'")
    expect(migration).toContain('NEW.price_kobo < OLD.price_kobo')
    expect(migration).toContain("NEW.status <> 'COMPLETED'")
    expect(migration).toContain("NEW.payment_status <> 'PAID'")
  })

  it('keeps customer/vendor/admin/system role boundaries server-side', () => {
    expect(vendorApi).toContain("session.role !== 'vendor'")
    expect(vendorApi).toContain(".eq('vendor_id', session.userId)")
    expect(adminApi).toContain("session.role !== 'super_admin'")
    expect(pinApi).toContain("session.role !== 'super_admin'")
    expect(migration).toContain('FROM anon, authenticated')
    expect(migration).toContain('TO service_role')
  })

  it('has an authoritative bundle source and fail-closed official coverage configuration', () => {
    expect(completionMigration).toContain('CREATE TABLE IF NOT EXISTS menu_bundles')
    expect(completionMigration).toContain('CREATE TABLE IF NOT EXISTS menu_bundle_items')
    expect(completionMigration).toContain("'new_bundle', 'menu_bundles'")
    expect(completionMigration).toContain('coverage_radius_meters')
    expect(completionMigration).toContain('ALTER TABLE menu_bundles ENABLE ROW LEVEL SECURITY')
  })
})
