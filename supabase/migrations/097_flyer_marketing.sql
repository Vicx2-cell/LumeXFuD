-- ============================================================
-- LumeX Fud - Migration 097: flyer marketing automation
-- ============================================================
-- Adds the event log + generated flyer history used by the automatic
-- vendor marketing system, plus a capped premium boost that keeps ranking
-- quality-led.

CREATE TABLE IF NOT EXISTS flyer_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  campaign_type     TEXT NOT NULL,
  source_entity_type TEXT NOT NULL DEFAULT '',
  source_entity_id  TEXT NOT NULL DEFAULT '',
  idempotency_key   TEXT NOT NULL UNIQUE,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'recorded'
                     CHECK (status IN ('recorded', 'generated', 'failed', 'ignored')),
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE flyer_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS generated_flyers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flyer_event_id      UUID NOT NULL REFERENCES flyer_events(id) ON DELETE CASCADE,
  vendor_id           UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  campaign_type       TEXT NOT NULL,
  source_entity_type  TEXT NOT NULL DEFAULT '',
  source_entity_id    TEXT NOT NULL DEFAULT '',
  template_id         TEXT NOT NULL,
  aspect_ratio        TEXT NOT NULL DEFAULT 'square'
                       CHECK (aspect_ratio IN ('square', 'status')),
  variation           INT NOT NULL DEFAULT 0,
  headline            TEXT NOT NULL DEFAULT '',
  subheadline         TEXT NOT NULL DEFAULT '',
  cta                 TEXT NOT NULL DEFAULT '',
  image_url           TEXT NOT NULL,
  thumbnail_url       TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'generating'
                       CHECK (status IN ('generating', 'ready', 'failed', 'archived', 'expired')),
  is_premium_campaign BOOLEAN NOT NULL DEFAULT FALSE,
  is_marketplace_campaign BOOLEAN NOT NULL DEFAULT FALSE,
  campaign_started_at TIMESTAMPTZ,
  campaign_ends_at    TIMESTAMPTZ,
  viewed_at           TIMESTAMPTZ,
  downloaded_at       TIMESTAMPTZ,
  shared_at           TIMESTAMPTZ,
  dismissed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flyer_event_id, variation)
);
ALTER TABLE generated_flyers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS flyer_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flyer_id      UUID NOT NULL REFERENCES generated_flyers(id) ON DELETE CASCADE,
  vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  metric_type   TEXT NOT NULL CHECK (metric_type IN ('view', 'download', 'share', 'impression', 'click', 'menu_visit', 'order')),
  metric_count  INT NOT NULL DEFAULT 1 CHECK (metric_count > 0),
  first_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (flyer_id, metric_type)
);
ALTER TABLE flyer_metrics ENABLE ROW LEVEL SECURITY;

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS premium_boost DECIMAL(6,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_flyer_events_vendor_created_at
  ON flyer_events (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_flyers_vendor_created_at
  ON generated_flyers (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_flyers_status
  ON generated_flyers (status, dismissed_at, downloaded_at);
CREATE INDEX IF NOT EXISTS idx_flyer_metrics_vendor_metric
  ON flyer_metrics (vendor_id, metric_type, last_at DESC);

INSERT INTO vendor_scores (vendor_id, premium_boost)
SELECT id, 0
FROM vendors
WHERE deleted_at IS NULL
ON CONFLICT (vendor_id) DO NOTHING;
