-- ============================================================
-- LumeX Fud — Migration 076: Saved places (customer-managed delivery locations)
-- ============================================================
-- A customer can DELIBERATELY save named delivery locations (label + optional
-- landmark, map pin, and photo) and mark ONE as "your usual" for one-tap reuse at
-- checkout. Distinct from customer_addresses (migration 050), which is the app
-- PASSIVELY learning where you order — saved places are named and user-editable.
--
-- PRIVACY: a place's pin + photo are precise personal location data (NDPR), like
-- the crowdsourced coordinates in migration 052. Service-role only (read + write
-- via API routes); photos live in a PRIVATE bucket served by short-lived signed
-- URLs (mirrors kyc-faces, migration 053). NEVER exposed to the anon key.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ─── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_places (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  landmark     TEXT,                              -- optional human cue for the rider
  latitude     DOUBLE PRECISION,                  -- optional map pin (all-or-nothing)
  longitude    DOUBLE PRECISION,
  photo_path   TEXT,                              -- storage key in private place-photos bucket
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,    -- "your usual"
  use_count    INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, label)
);
ALTER TABLE saved_places ENABLE ROW LEVEL SECURITY;

-- List ordering: default → most-reused → most-recent.
CREATE INDEX IF NOT EXISTS idx_saved_places_customer
  ON saved_places (customer_id, is_default DESC, use_count DESC, last_used_at DESC NULLS LAST);

-- At most ONE "your usual" per customer (enforced in-DB, not just in code).
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_places_one_default
  ON saved_places (customer_id) WHERE is_default;

-- Service-role-only, like every other customer-location table (auth enforced in code).
DROP POLICY IF EXISTS "service_role_saved_places" ON saved_places;
CREATE POLICY "service_role_saved_places" ON saved_places
  FOR ALL USING (auth.role() = 'service_role');

-- ─── 2. set_default_place: flip "your usual" atomically ───────────────────────
-- Clearing the old default and setting the new one must happen together, or the
-- partial unique index above would reject the second UPDATE. One SECURITY DEFINER
-- function does both in a single statement-scope transaction. Ownership is
-- enforced by requiring p_customer_id to match (the route passes the session id).
-- SECURITY DEFINER bypasses RLS, so it is hardened two ways: (1) a pinned, empty
-- search_path with fully-qualified object names (no search_path-hijack surface),
-- and (2) EXECUTE revoked from anon/authenticated below so PostgREST never exposes
-- it — the routes call it via the service role only.
CREATE OR REPLACE FUNCTION set_default_place(p_customer_id UUID, p_place_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_owned BOOLEAN;
BEGIN
  SELECT TRUE INTO v_owned
  FROM public.saved_places
  WHERE id = p_place_id AND customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.saved_places
  SET is_default = (id = p_place_id),
      updated_at = NOW()
  WHERE customer_id = p_customer_id
    AND is_default <> (id = p_place_id);

  RETURN TRUE;
END;
$$;

-- ─── 3. touch_saved_place: bump reuse stats on checkout ───────────────────────
-- Called (best-effort) when a saved place is reused so the list self-orders by
-- genuine usage. Scoped to the owner. Hardened like set_default_place above.
CREATE OR REPLACE FUNCTION touch_saved_place(p_customer_id UUID, p_place_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
BEGIN
  UPDATE public.saved_places
  SET use_count    = use_count + 1,
      last_used_at = NOW(),
      updated_at   = NOW()
  WHERE id = p_place_id AND customer_id = p_customer_id;
END;
$$;

-- Lock down RPC exposure: these run as the definer (bypassing RLS), so they must
-- NOT be reachable through the PostgREST /rpc endpoint with the anon/authenticated
-- key. Revoke the default PUBLIC EXECUTE and grant only the service role, which is
-- the only caller (auth is enforced in the API-route code).
REVOKE ALL ON FUNCTION set_default_place(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION touch_saved_place(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_default_place(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION touch_saved_place(UUID, UUID) TO service_role;

-- ─── 4. place-photos storage bucket (PRIVATE) ─────────────────────────────────
-- Photos of a customer's door/gate are precise personal data — PRIVATE, no public
-- read policy. All access via the service role, which mints short-lived signed
-- URLs in GET /api/customer/places. Mirrors kyc-faces (migration 053).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'place-photos',
  'place-photos',
  FALSE,
  5242880, -- 5MB, matches MAX_IMAGE_BYTES
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Deliberately NO storage.objects SELECT policy: only the service role reads these.
