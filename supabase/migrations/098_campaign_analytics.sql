-- ============================================================
-- LumeX Fud - Migration 098: campaign analytics + attribution
-- ============================================================
-- Tracks anonymized campaign engagement and conversion events without exposing
-- private customer data to vendors. Rows are append-only and deduped by event_id.

CREATE TABLE IF NOT EXISTS campaign_events (
  event_id     TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  flyer_id     UUID,
  vendor_id    UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id      UUID,
  session_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  source       TEXT NOT NULL,
  placement    TEXT NOT NULL DEFAULT '',
  target_type  TEXT NOT NULL DEFAULT '',
  target_id    TEXT NOT NULL DEFAULT '',
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE campaign_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_created_at
  ON campaign_events (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_vendor_created_at
  ON campaign_events (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_type_created_at
  ON campaign_events (event_type, created_at DESC);
