-- ============================================================
-- LumeX Fud - delivery zone checkout mode
-- ============================================================
-- Lets each delivery zone decide whether checkout should show the curated lodge
-- catalog/map picker or plain manual address entry. Existing live Uturu behavior
-- is preserved by enabling the flag for the seeded default zone.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS uses_lodge_catalog BOOLEAN NOT NULL DEFAULT false;

UPDATE delivery_zones
SET uses_lodge_catalog = true,
    updated_at = now()
WHERE uses_lodge_catalog = false
  AND name = 'Uturu Default';
