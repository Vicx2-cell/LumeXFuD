-- ============================================================
-- LumeX Feed - Migration 108: event batching and attribution
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE feed_impressions
  ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT '2026-07-10.feed.attr.rule.v1',
  ADD COLUMN IF NOT EXISTS algorithm_version TEXT NOT NULL DEFAULT '2026-07-10.feed.attr.v1',
  ADD COLUMN IF NOT EXISTS batch_key TEXT;
CREATE INDEX IF NOT EXISTS feed_impressions_batch_idx ON feed_impressions(batch_key, created_at DESC);

ALTER TABLE feed_events
  ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT '2026-07-10.feed.attr.rule.v1',
  ADD COLUMN IF NOT EXISTS algorithm_version TEXT NOT NULL DEFAULT '2026-07-10.feed.attr.v1',
  ADD COLUMN IF NOT EXISTS batch_key TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS feed_events_batch_idx ON feed_events(batch_key, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_events_session_idx ON feed_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key TEXT NOT NULL UNIQUE,
  viewer_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  source_tab TEXT,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  deduped_count INTEGER NOT NULL DEFAULT 0 CHECK (deduped_count >= 0),
  rule_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_event_batches_viewer_idx ON feed_event_batches(viewer_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_event_batches_tab_idx ON feed_event_batches(source_tab, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_attribution_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL UNIQUE,
  rule_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  attribution_window_minutes INTEGER NOT NULL CHECK (attribution_window_minutes > 0),
  minimum_confidence NUMERIC(5, 4) NOT NULL DEFAULT 0.3500,
  max_sources_per_order INTEGER NOT NULL DEFAULT 3 CHECK (max_sources_per_order > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_attribution_rules_enabled_idx ON feed_attribution_rules(enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS feed_order_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  source_event_id UUID NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
  source_event_type TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attribution_window_minutes INTEGER NOT NULL,
  rule_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
  revenue_kobo BIGINT NOT NULL DEFAULT 0 CHECK (revenue_kobo >= 0),
  status TEXT NOT NULL DEFAULT 'credited' CHECK (status IN ('credited', 'reversed', 'expired', 'void')),
  reversal_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS feed_order_attributions_order_idx ON feed_order_attributions(order_id, attributed_at DESC);
CREATE INDEX IF NOT EXISTS feed_order_attributions_post_idx ON feed_order_attributions(post_id, attributed_at DESC);
CREATE INDEX IF NOT EXISTS feed_order_attributions_viewer_idx ON feed_order_attributions(viewer_profile_id, attributed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS feed_order_attributions_order_event_uidx ON feed_order_attributions(order_id, source_event_id);

INSERT INTO feed_attribution_rules (
  rule_key, rule_version, algorithm_version, attribution_window_minutes, minimum_confidence, max_sources_per_order, enabled, metadata
)
VALUES (
  'default',
  '2026-07-10.feed.attr.rule.v1',
  '2026-07-10.feed.attr.v1',
  4320,
  0.3500,
  3,
  TRUE,
  '{"notes":"Server-side feed conversion attribution with dedupe, batch logging, and refund reversal support."}'::jsonb
)
ON CONFLICT (rule_key) DO NOTHING;

ALTER TABLE feed_event_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_attribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_order_attributions ENABLE ROW LEVEL SECURITY;
