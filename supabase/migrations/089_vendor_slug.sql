-- ============================================================
-- LumeX Fud — Migration 089: Vendor SEO slug
-- ============================================================
-- Adds a human-readable, URL-safe `slug` to vendors so the public SEO pages can
-- live at /uturu/vendor/mama-blessing-kitchen instead of an opaque UUID. Better
-- for ranking (keyword in URL) and trust (a real name, not a GUID).
--
-- Design choices that matter for SEO durability:
--   • The slug is generated ONCE, on INSERT, and is NEVER auto-rewritten when the
--     shop is later renamed. A changing URL throws away accrued link equity and
--     breaks anyone who shared the old link. If a shop renames, an admin can set a
--     new slug deliberately (and we'd 301 the old one) — but the system never does
--     it silently.
--   • Collisions are resolved deterministically with a -2, -3, … suffix so two
--     "Mama's Kitchen" shops both get a stable, unique URL.
--   • The in-app ordering page stays at /vendor/[id] (UUID) — untouched. This slug
--     only powers the new public /uturu/vendor/[slug] content pages.
--
-- Purely additive + idempotent: the column is nullable at the DB level (the app
-- treats a missing slug as "no SEO page yet"), so deploying code before this runs
-- is safe.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── Column ──────────────────────────────────────────────────────────────────
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS slug TEXT;

-- ─── slugify(text) → url-safe slug ───────────────────────────────────────────
-- lower → strip accents → non-alphanumerics to hyphen → collapse → trim.
-- IMMUTABLE so it can be used anywhere; mirrors lib/seo/slug.ts on the app side.
CREATE OR REPLACE FUNCTION lx_slugify(input TEXT)
RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  -- unaccent isn't guaranteed installed; do a plain lower + ascii-ish fold.
  s := lower(btrim(input));
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g'); -- anything not [a-z0-9] → hyphen
  s := regexp_replace(s, '-{2,}', '-', 'g');       -- collapse runs
  s := btrim(s, '-');                              -- trim leading/trailing hyphens
  IF s = '' THEN s := 'vendor'; END IF;            -- never empty
  RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── Assign a UNIQUE slug for one vendor (base + numeric suffix on collision) ──
CREATE OR REPLACE FUNCTION lx_unique_vendor_slug(p_base TEXT, p_self UUID)
RETURNS TEXT AS $$
DECLARE
  base    TEXT := lx_slugify(p_base);
  cand    TEXT := base;
  n       INT  := 1;
BEGIN
  WHILE EXISTS (
    SELECT 1 FROM vendors
     WHERE slug = cand
       AND (p_self IS NULL OR id <> p_self)
  ) LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END;
$$ LANGUAGE plpgsql;

-- ─── Backfill existing rows (deterministic by created_at, then id) ────────────
-- Done one row at a time so the uniqueness check sees prior assignments.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, shop_name FROM vendors
     WHERE slug IS NULL
     ORDER BY created_at NULLS FIRST, id
  LOOP
    UPDATE vendors
       SET slug = lx_unique_vendor_slug(r.shop_name, r.id)
     WHERE id = r.id;
  END LOOP;
END $$;

-- ─── Auto-assign on INSERT (only when not supplied) ──────────────────────────
-- BEFORE INSERT so a freshly created vendor always has a stable, unique slug.
-- Never fires on UPDATE → renaming the shop does NOT change the slug.
CREATE OR REPLACE FUNCTION lx_set_vendor_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := lx_unique_vendor_slug(NEW.shop_name, NEW.id);
  ELSE
    NEW.slug := lx_unique_vendor_slug(NEW.slug, NEW.id); -- normalise + dedupe a supplied slug
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_vendor_slug ON vendors;
CREATE TRIGGER trg_set_vendor_slug
BEFORE INSERT ON vendors
FOR EACH ROW
EXECUTE FUNCTION lx_set_vendor_slug();

-- ─── Uniqueness (case the app relies on) ─────────────────────────────────────
-- Partial unique index ignores NULLs so the column can stay nullable while still
-- guaranteeing no two vendors share a slug.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_slug
  ON vendors (slug) WHERE slug IS NOT NULL;
