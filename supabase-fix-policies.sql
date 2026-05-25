-- ============================================================
-- LumeX Fud — Fix Policies (run this if migration errored on policies)
-- Drops all existing deny_anon policies then recreates them.
-- Safe to run multiple times.
-- ============================================================

-- Drop existing policies if they exist
DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'customers','vendors','menu_items','riders','orders','order_items',
    'payments','refunds','vendor_subscriptions','ratings','disputes',
    'notifications','settings','audit_logs','otp_codes','sessions',
    'processed_webhooks','otp_attempts','order_messages',
    'wallet_balances','wallet_transactions'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "deny_anon_%s" ON %I', t, t);
  END LOOP;
END $$;

-- Recreate RLS policies
CREATE POLICY "deny_anon_customers" ON customers FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_vendors" ON vendors FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_menu_items" ON menu_items FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_riders" ON riders FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_orders" ON orders FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_order_items" ON order_items FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_payments" ON payments FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_refunds" ON refunds FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_vendor_subscriptions" ON vendor_subscriptions FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_ratings" ON ratings FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_disputes" ON disputes FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_notifications" ON notifications FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_settings" ON settings FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_audit_logs" ON audit_logs FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_otp_codes" ON otp_codes FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_sessions" ON sessions FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_processed_webhooks" ON processed_webhooks FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_otp_attempts" ON otp_attempts FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_order_messages" ON order_messages FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_wallet_balances" ON wallet_balances FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_wallet_transactions" ON wallet_transactions FOR ALL TO anon USING (false);

-- Enable Realtime (safe if already enabled)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Create the generate_order_number function
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  seq_val BIGINT;
  year_str TEXT;
BEGIN
  seq_val := nextval('order_seq');
  year_str := EXTRACT(YEAR FROM NOW())::TEXT;
  RETURN 'LXF-' || year_str || '-' || LPAD(seq_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Confirm
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') AS total_tables,
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_type = 'CHECK' AND table_schema = 'public') AS check_constraints,
  'Policies fixed. Database ready.' AS status;
