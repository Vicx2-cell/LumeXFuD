-- ============================================================
-- LumeX Fud — Migration 073: Handover codes + Consent layer
-- ============================================================
-- Builds on 072 (Pickup / Order Ahead) and adds the cross-cutting machinery the
-- pickup_v1 + delivery_handover_v1 features need:
--
--   1. HASHED handover codes on orders (Invariant I3 + B1). The 4-digit plaintext
--      `pickup_code` from 072 is RETIRED — never written, never read, never sent.
--      Codes are now 6-char Crockford-Base32, generated with a CSPRNG, and only
--      the SHA-256 hash is ever persisted. The raw code lives in exactly two
--      places: the customer's app (display) and nowhere on the server but a hash.
--   2. The 1h25m PICKUP forfeit clock anchored to READY (Invariant I7) — the
--      customer is never charged the vendor's prep time — with a per-order
--      wrong-attempt counter + lock that backstops the Upstash limiter.
--   3. LEAVE-AT-GATE delivery (code waived, photo proof).
--   4. A versioned, per-role TERMS set + an APPEND-ONLY consent log (Invariant I8)
--      — every binding action by every party is recorded against the terms
--      version in force, immutable, and exposed read-only to the super admin as
--      the dispute record.
--   5. No-show STRIKES on customers (repeat-abuse guard for pickup).
--
-- All access is via the service role in API-route code (auth enforced in code,
-- never via RLS), consistent with the rest of the platform. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── 1. orders: hashed handover code + leave-at-gate + ready-anchored clock ───
-- handover_code_hash    : SHA-256 hex of the current code. NULL until issued.
-- handover_code_set_at  : when the current code was issued (rotation timestamp).
-- handover_code_attempts: wrong-entry counter for THIS order (DB backstop to the
--                         Upstash limiter); reset to 0 on issue/refresh.
-- handover_code_locked  : TRUE after the attempt cap is hit → the fulfiller is
--                         blocked until the customer refreshes (reissues) the code.
-- leave_at_gate         : customer opted to waive the door code (delivery only).
-- handover_method       : how the order was handed over, for the audit/ledger trail.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_code_hash     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_code_set_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_code_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_code_locked   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS leave_at_gate          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_method        TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_handover_method_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_handover_method_check
      CHECK (handover_method IS NULL OR handover_method IN ('CODE','LEAVE_AT_GATE'));
  END IF;
END $$;

-- Atomically increment a single order's wrong-attempt counter and lock it once the
-- cap is reached. Row-locked so two concurrent guesses can't both slip under the
-- cap. Returns the new count + whether the order is now locked.
CREATE OR REPLACE FUNCTION bump_handover_attempts(p_order_id TEXT, p_limit INT DEFAULT 5)
RETURNS TABLE(attempts INT, locked BOOLEAN) AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT handover_code_attempts INTO v_count
  FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, FALSE; RETURN;
  END IF;
  v_count := v_count + 1;
  UPDATE orders
     SET handover_code_attempts = v_count,
         handover_code_locked   = (v_count >= p_limit),
         updated_at             = NOW()
   WHERE id = p_order_id;
  RETURN QUERY SELECT v_count, (v_count >= p_limit);
END;
$$ LANGUAGE plpgsql;

-- ─── 2. settings: pickup window, strike limit, goodwill toggle ────────────────
-- pickup_hold_minutes is the AUTHORITATIVE 1h25m (85-min) forfeit window, anchored
-- to when the order is marked READY (supersedes 072's pickup_noshow_minutes, which
-- is left in place but no longer read by the new flow).
INSERT INTO settings (id, value) VALUES
  ('pickup_hold_minutes',          '{"minutes": 85}'::jsonb),
  ('pickup_noshow_strike_limit',   '{"count": 3}'::jsonb),
  ('pickup_first_noshow_goodwill', '{"enabled": false}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ─── 3. customers: pickup no-show strikes ─────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pickup_strikes INT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pickup_banned  BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 4. terms_versions: per-role, versioned rules ─────────────────────────────
-- Editing terms = inserting a new row with the next version for that role. The
-- "current" version for a role is MAX(version). A consent row pins the version
-- the actor agreed to, so the record survives later edits.
CREATE TABLE IF NOT EXISTS terms_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role       TEXT NOT NULL CHECK (role IN ('customer','vendor','rider')),
  version    INT  NOT NULL,
  content    TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role, version)
);

-- Seed v1 for each role (only if that role has no terms yet).
INSERT INTO terms_versions (role, version, content, created_by)
SELECT v.role, 1, v.content, 'system'
FROM (VALUES
  ('customer',
   'When you pay for a pickup order you agree: once your food is marked ready, it is held for 1 hour 25 minutes. If you do not collect it within that time, the order is cleared and your payment is not refunded. If the vendor never marks your order ready, you are fully refunded. Your collection code is private — show it only to the vendor in person. LumeX will never call to ask for it.'),
  ('vendor',
   'When you accept a pickup or delivery order you agree to: prepare the order only after payment is captured, hand it over only to the person presenting the correct collection code, and never share or request that code by phone or message. Marking an order ready starts the customer''s collection window.'),
  ('rider',
   'When you accept a delivery you agree to: deliver the order, handle the customer''s phone number and location responsibly and only for this delivery, and complete the handover only by entering the customer''s code in person (or by an approved leave-at-gate drop with photo proof). Never request the code by phone or message.')
) AS v(role, content)
WHERE NOT EXISTS (SELECT 1 FROM terms_versions t WHERE t.role = v.role);

ALTER TABLE terms_versions ENABLE ROW LEVEL SECURITY;
-- No permissive policy for anon/authenticated → denied by default. The service
-- role (app code) bypasses RLS; auth is enforced in the route.

-- ─── 5. consent_log: APPEND-ONLY record of every binding action ───────────────
-- One row per agreed binding action. Never updated, never deleted (trigger below,
-- same guard as the audit logs in migration 056).
CREATE TABLE IF NOT EXISTS consent_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('customer','vendor','rider','admin','super_admin')),
  action        TEXT NOT NULL,
  order_id      TEXT,
  terms_version INT,
  ip_address    TEXT,
  user_agent    TEXT,
  agreed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_log_order  ON consent_log (order_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_actor  ON consent_log (actor_id, agreed_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_log_action ON consent_log (action, agreed_at DESC);

ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;
-- deny-by-default for anon/authenticated; service-role only, like the audit logs.

-- Make it append-only for EVERYONE including the table owner / service role,
-- reusing the exact guard installed by migration 056.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'forbid_audit_mutation') THEN
    DROP TRIGGER IF EXISTS trg_append_only_consent_log ON public.consent_log;
    CREATE TRIGGER trg_append_only_consent_log
      BEFORE UPDATE OR DELETE ON public.consent_log
      FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
  END IF;
END $$;
