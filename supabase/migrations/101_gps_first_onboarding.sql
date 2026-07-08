-- ============================================================
-- LumeX Fud - GPS-first onboarding, locations, and delivery proof
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS whatsapp_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rough_location_description TEXT,
  ADD COLUMN IF NOT EXISTS official_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS official_longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS storefront_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS business_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_name TEXT;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS whatsapp_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nin TEXT,
  ADD COLUMN IF NOT EXISTS id_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS live_selfie_url TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_name TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_phone TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS plate_number TEXT,
  ADD COLUMN IF NOT EXISTS last_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS last_longitude NUMERIC;

ALTER TABLE vendors
  DROP CONSTRAINT IF EXISTS vendors_approval_state_ck;
ALTER TABLE vendors
  ADD CONSTRAINT vendors_approval_state_ck
  CHECK (approval_state IN (
    'draft',
    'application_submitted',
    'under_review',
    'inspection_scheduled',
    'shop_inspected',
    'approved',
    'rejected',
    'suspended',
    'pending_review'
  ));

ALTER TABLE riders
  DROP CONSTRAINT IF EXISTS riders_approval_state_ck;
ALTER TABLE riders
  ADD CONSTRAINT riders_approval_state_ck
  CHECK (approval_state IN (
    'draft',
    'application_submitted',
    'under_review',
    'verification_failed',
    'approved',
    'rejected',
    'suspended',
    'offline',
    'online',
    'on_delivery',
    'pending_review'
  ));

CREATE TABLE IF NOT EXISTS vendor_applications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id               UUID REFERENCES vendors(id) ON DELETE SET NULL,
  whatsapp_number         TEXT NOT NULL,
  whatsapp_verified       BOOLEAN NOT NULL DEFAULT false,
  business_name           TEXT NOT NULL,
  owner_name              TEXT NOT NULL,
  category                TEXT NOT NULL,
  what_they_sell          TEXT NOT NULL,
  rough_location_description TEXT,
  operating_hours         TEXT,
  status                  TEXT NOT NULL DEFAULT 'application_submitted'
                           CHECK (status IN (
                             'draft',
                             'application_submitted',
                             'under_review',
                             'inspection_scheduled',
                             'shop_inspected',
                             'approved',
                             'rejected',
                             'suspended'
                           )),
  review_notes            TEXT,
  rejection_reason        TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rider_applications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id                UUID REFERENCES riders(id) ON DELETE SET NULL,
  whatsapp_number         TEXT NOT NULL,
  whatsapp_verified       BOOLEAN NOT NULL DEFAULT false,
  full_name               TEXT NOT NULL,
  date_of_birth           DATE,
  nin                     TEXT,
  id_photo_url            TEXT,
  live_selfie_url         TEXT,
  guarantor_name          TEXT NOT NULL,
  guarantor_phone         TEXT NOT NULL,
  vehicle_type            TEXT NOT NULL,
  vehicle_photo_url       TEXT,
  plate_number            TEXT,
  status                  TEXT NOT NULL DEFAULT 'application_submitted'
                           CHECK (status IN (
                             'draft',
                             'application_submitted',
                             'under_review',
                             'verification_failed',
                             'approved',
                             'rejected',
                             'suspended'
                           )),
  review_notes            TEXT,
  rejection_reason        TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  latitude          NUMERIC NOT NULL,
  longitude         NUMERIC NOT NULL,
  delivery_note     TEXT,
  city_id           UUID REFERENCES cities(id),
  zone_id           UUID REFERENCES delivery_zones(id),
  is_active         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verified_places (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  canonical_latitude  NUMERIC NOT NULL,
  canonical_longitude NUMERIC NOT NULL,
  city                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'candidate'
                       CHECK (status IN ('candidate', 'verified', 'rejected')),
  confidence_count    INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verified_place_votes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verified_place_id       UUID NOT NULL REFERENCES verified_places(id) ON DELETE CASCADE,
  order_id                UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_location_label TEXT,
  latitude                NUMERIC NOT NULL,
  longitude               NUMERIC NOT NULL,
  delivered_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS place_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verified_place_id    UUID NOT NULL REFERENCES verified_places(id) ON DELETE CASCADE,
  rider_id             UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,
  note                TEXT NOT NULL,
  is_hidden           BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_status_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_type                  TEXT NOT NULL,
  actor_id                    TEXT NOT NULL,
  status                      TEXT NOT NULL,
  latitude                    NUMERIC,
  longitude                   NUMERIC,
  gps_accuracy                NUMERIC,
  distance_from_expected_meters NUMERIC,
  validation_status           TEXT NOT NULL DEFAULT 'not_validated',
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number  TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  verified_at   TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_applications_status_created
  ON vendor_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rider_applications_status_created
  ON rider_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_locations_customer_active
  ON customer_locations(customer_id, is_active DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verified_places_city_status
  ON verified_places(city, status, confidence_count DESC);
CREATE INDEX IF NOT EXISTS idx_verified_place_votes_place
  ON verified_place_votes(verified_place_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_notes_place_hidden
  ON place_notes(verified_place_id, is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_status_events_order
  ON order_status_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_phone_purpose
  ON otp_verifications(phone_number, purpose, expires_at DESC);

ALTER TABLE vendor_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_place_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;
