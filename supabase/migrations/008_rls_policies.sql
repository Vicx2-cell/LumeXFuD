-- ============================================================
-- LumeX Fud — Migration 008: RLS Policies
--
-- CRITICAL RULES:
--   • RLS already enabled in each migration file.
--   • NEVER use USING (true) — that is fake security.
--   • Service role bypasses all RLS (used by API routes).
--   • These policies govern anon + authenticated (JWT) access.
--
-- Verify after running:
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = false;
--   -- Must return ZERO rows.
-- ============================================================

-- ─── Drop existing policies to avoid conflicts on re-run ─────────────────────
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rec.policyname, rec.tablename);
  END LOOP;
END $$;

-- ─── SETTINGS (read-only public; only super_admin writes via service role) ────
CREATE POLICY "public can read settings" ON settings
  FOR SELECT USING (true);

-- ─── VENDORS (public read for active/open vendors; no PII) ───────────────────
CREATE POLICY "public read active vendors" ON vendors
  FOR SELECT USING (is_active = true AND deleted_at IS NULL);

-- Vendors manage their own record via service role in API routes.
-- No direct JWT-based write from client.

-- ─── MENU ITEMS (public read for available items) ────────────────────────────
CREATE POLICY "public read available menu items" ON menu_items
  FOR SELECT USING (is_available = true AND deleted_at IS NULL);

-- ─── CUSTOMERS (only own data) ───────────────────────────────────────────────
CREATE POLICY "customers read own profile" ON customers
  FOR SELECT USING (phone = (auth.jwt() ->> 'phone'));

CREATE POLICY "customers update own profile" ON customers
  FOR UPDATE USING (phone = (auth.jwt() ->> 'phone'));

-- ─── ORDERS (role-based visibility) ──────────────────────────────────────────
-- ::TEXT casts on both sides of IN so UUID vs TEXT column types never conflict.

CREATE POLICY "customers see own orders" ON orders
  FOR SELECT USING (
    customer_id::TEXT = (
      SELECT id::TEXT FROM customers WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

CREATE POLICY "vendors see own orders" ON orders
  FOR SELECT USING (
    vendor_id::TEXT = (
      SELECT id::TEXT FROM vendors WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

CREATE POLICY "riders see assigned or available orders" ON orders
  FOR SELECT USING (
    rider_id::TEXT = (
      SELECT id::TEXT FROM riders WHERE phone = (auth.jwt() ->> 'phone')
    )
    OR (status = 'READY' AND rider_id IS NULL)
  );

-- ─── ORDER ITEMS ─────────────────────────────────────────────────────────────
CREATE POLICY "order items visible with order" ON order_items
  FOR SELECT USING (
    order_id::TEXT IN (
      SELECT id::TEXT FROM orders
      WHERE
        customer_id::TEXT = (
          SELECT id::TEXT FROM customers WHERE phone = (auth.jwt() ->> 'phone')
        )
        OR vendor_id::TEXT = (
          SELECT id::TEXT FROM vendors WHERE phone = (auth.jwt() ->> 'phone')
        )
        OR rider_id::TEXT = (
          SELECT id::TEXT FROM riders WHERE phone = (auth.jwt() ->> 'phone')
        )
    )
  );

-- ─── WALLET BALANCES ─────────────────────────────────────────────────────────
-- wallet_balances.user_id is TEXT; cast id::TEXT to match.
CREATE POLICY "users see own wallet" ON wallet_balances
  FOR SELECT USING (
    (user_type = 'VENDOR' AND user_id IN (
      SELECT id::TEXT FROM vendors WHERE phone = (auth.jwt() ->> 'phone')
    ))
    OR
    (user_type = 'RIDER' AND user_id IN (
      SELECT id::TEXT FROM riders WHERE phone = (auth.jwt() ->> 'phone')
    ))
  );

-- ─── WALLET TRANSACTIONS ─────────────────────────────────────────────────────
CREATE POLICY "users see own wallet transactions" ON wallet_transactions
  FOR SELECT USING (
    (user_type = 'VENDOR' AND user_id IN (
      SELECT id::TEXT FROM vendors WHERE phone = (auth.jwt() ->> 'phone')
    ))
    OR
    (user_type = 'RIDER' AND user_id IN (
      SELECT id::TEXT FROM riders WHERE phone = (auth.jwt() ->> 'phone')
    ))
  );

-- ─── TRENDING DATA (public read for homepage) ─────────────────────────────────
CREATE POLICY "public read trending" ON trending_data
  FOR SELECT USING (true);

-- ─── DISPUTES ────────────────────────────────────────────────────────────────
CREATE POLICY "customers see own disputes" ON disputes
  FOR SELECT USING (
    customer_id::TEXT = (
      SELECT id::TEXT FROM customers WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

-- ─── ALL SENSITIVE TABLES: deny anon completely ───────────────────────────────
-- (service_role bypasses these; authenticated JWT access is handled above)

CREATE POLICY "deny anon sessions" ON sessions
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon otp attempts" ON otp_attempts
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon processed webhooks" ON processed_webhooks
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon audit logs" ON audit_logs
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon super audit logs" ON super_audit_logs
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon admin devices" ON admin_devices
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon admins" ON admins
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon refunds" ON refunds
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon vendor subscriptions" ON vendor_subscriptions
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon notifications" ON notifications
  FOR ALL TO anon USING (false);

CREATE POLICY "deny anon pin reset audit" ON pin_reset_audit
  FOR ALL TO anon USING (false);
