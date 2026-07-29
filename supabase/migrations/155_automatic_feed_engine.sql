-- LumeX Fud automatic feed engine: durable events, provenance, controls and pins.
-- Automation is disabled by default until operations explicitly enables it.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS automatic_post_type TEXT,
  ADD COLUMN IF NOT EXISTS source_event_type TEXT,
  ADD COLUMN IF NOT EXISTS source_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS source_entity_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS area_scope TEXT,
  ADD COLUMN IF NOT EXISTS area_id UUID,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_version TEXT,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS link_target_type TEXT,
  ADD COLUMN IF NOT EXISTS link_target_id TEXT,
  ADD COLUMN IF NOT EXISTS cta_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_generation_mode_ck;
ALTER TABLE posts ADD CONSTRAINT posts_generation_mode_ck
  CHECK (generation_mode IN ('manual', 'automatic'));
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_area_scope_ck;
ALTER TABLE posts ADD CONSTRAINT posts_area_scope_ck
  CHECK (area_scope IS NULL OR area_scope IN ('global', 'city', 'campus', 'delivery_area'));
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_moderation_status_ck;
ALTER TABLE posts ADD CONSTRAINT posts_moderation_status_ck
  CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'limited'));

CREATE UNIQUE INDEX IF NOT EXISTS posts_automatic_idempotency_uidx
  ON posts(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_automatic_source_idx
  ON posts(source_event_type, source_entity_id, generated_at DESC)
  WHERE generation_mode = 'automatic';

CREATE TABLE IF NOT EXISTS feed_automation_settings (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  vendor_daily_limit INTEGER NOT NULL DEFAULT 2 CHECK (vendor_daily_limit BETWEEN 0 AND 20),
  official_area_window_limit INTEGER NOT NULL DEFAULT 1 CHECK (official_area_window_limit BETWEEN 0 AND 20),
  duplicate_topic_cooldown_hours INTEGER NOT NULL DEFAULT 72 CHECK (duplicate_topic_cooldown_hours BETWEEN 1 AND 2160),
  menu_batch_window_minutes INTEGER NOT NULL DEFAULT 30 CHECK (menu_batch_window_minutes BETWEEN 1 AND 1440),
  price_drop_minimum_bps INTEGER NOT NULL DEFAULT 1000 CHECK (price_drop_minimum_bps BETWEEN 1 AND 10000),
  price_drop_minimum_kobo BIGINT NOT NULL DEFAULT 50000 CHECK (price_drop_minimum_kobo >= 0),
  back_in_stock_minimum_orders INTEGER NOT NULL DEFAULT 2 CHECK (back_in_stock_minimum_orders >= 0),
  popularity_minimum_orders INTEGER NOT NULL DEFAULT 10 CHECK (popularity_minimum_orders >= 2),
  anonymity_minimum_orders INTEGER NOT NULL DEFAULT 5 CHECK (anonymity_minimum_orders >= 2),
  order_aggregation_hours INTEGER NOT NULL DEFAULT 6 CHECK (order_aggregation_hours BETWEEN 1 AND 720),
  affordability_max_item_kobo BIGINT NOT NULL DEFAULT 200000 CHECK (affordability_max_item_kobo >= 0),
  affordability_max_meal_kobo BIGINT NOT NULL DEFAULT 200000 CHECK (affordability_max_meal_kobo >= 0),
  collection_item_count INTEGER NOT NULL DEFAULT 5 CHECK (collection_item_count BETWEEN 3 AND 10),
  enabled_post_types JSONB NOT NULL DEFAULT '{
    "vendor_welcome":true,"new_menu_item":true,"item_back_in_stock":true,
    "price_drop":true,"new_bundle":true,"popular_item":true,
    "vendor_reopened":true,"order_milestone":true,
    "cheap_eats":true,"breakfast_collection":true,"lunch_collection":true,
    "evening_collection":true,"late_night_collection":true,
    "new_on_lumex":true,"popular_near_you":true,"back_in_stock":true,
    "lumex_picks":true,"order_activity_collection":true
  }'::jsonb,
  milestone_values INTEGER[] NOT NULL DEFAULT ARRAY[25,50,100,500],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
INSERT INTO feed_automation_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vendor_feed_automation_settings (
  vendor_id UUID PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  optional_marketing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  automation_paused BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_post_types TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS feed_automation_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  city_id UUID REFERENCES cities(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'suppressed', 'retry', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_automation_outbox_claim_idx
  ON feed_automation_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS feed_automation_outbox_vendor_idx
  ON feed_automation_outbox(vendor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_generation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID REFERENCES feed_automation_outbox(id) ON DELETE SET NULL,
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'enqueued','claimed','published','suppressed','retried','failed','archived',
    'regenerated','pinned','unpinned','pin_expired','cta_disabled'
  )),
  reason TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_generation_audit_post_idx
  ON feed_generation_audit(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_generation_audit_outbox_idx
  ON feed_generation_audit(outbox_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_post_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','city','campus','delivery_area')),
  scope_id UUID,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  pinned_by TEXT NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unpinned_by TEXT,
  unpinned_at TIMESTAMPTZ,
  CHECK ((scope_type = 'global' AND scope_id IS NULL) OR (scope_type <> 'global' AND scope_id IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS feed_post_pins_one_primary_scope_uidx
  ON feed_post_pins(scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE unpinned_at IS NULL;
CREATE INDEX IF NOT EXISTS feed_post_pins_active_idx
  ON feed_post_pins(scope_type, scope_id, priority DESC, starts_at DESC)
  WHERE unpinned_at IS NULL;

CREATE OR REPLACE FUNCTION claim_feed_automation_jobs(p_limit INTEGER DEFAULT 20)
RETURNS SETOF feed_automation_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE feed_automation_outbox jobs
  SET status = 'processing', attempts = jobs.attempts + 1,
      claimed_at = NOW(), updated_at = NOW()
  WHERE jobs.id IN (
    SELECT id FROM feed_automation_outbox
    WHERE status IN ('pending','retry') AND available_at <= NOW()
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  RETURNING jobs.*;
END;
$$;
REVOKE ALL ON FUNCTION claim_feed_automation_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_feed_automation_jobs(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION enqueue_marketplace_feed_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event_name TEXT;
  entity_id TEXT;
  event_vendor_id UUID;
  event_city_id UUID;
  event_zone_id UUID;
  event_payload JSONB;
  event_key_value TEXT;
BEGIN
  IF TG_TABLE_NAME = 'vendors' THEN
    IF TG_OP = 'UPDATE'
       AND OLD.approval_state IS DISTINCT FROM 'approved'
       AND NEW.approval_state = 'approved' THEN
      event_name := 'vendor_welcome';
    ELSIF TG_OP = 'UPDATE'
       AND OLD.status = 'CLOSED' AND NEW.status = 'OPEN'
       AND NEW.updated_at - OLD.updated_at >= INTERVAL '12 hours' THEN
      event_name := 'vendor_reopened';
    ELSE RETURN NEW;
    END IF;
    entity_id := NEW.id::text; event_vendor_id := NEW.id;
    event_city_id := NEW.city_id; event_zone_id := NEW.zone_id;
    event_payload := jsonb_build_object('approval_state', NEW.approval_state, 'status', NEW.status);
  ELSIF TG_TABLE_NAME = 'menu_items' THEN
    entity_id := NEW.id::text; event_vendor_id := NEW.vendor_id;
    SELECT city_id, zone_id INTO event_city_id, event_zone_id FROM vendors WHERE id = NEW.vendor_id;
    IF TG_OP = 'INSERT' AND NEW.is_available AND NEW.deleted_at IS NULL THEN
      event_name := 'new_menu_item';
    ELSIF TG_OP = 'UPDATE' AND NOT COALESCE(OLD.is_available, FALSE)
          AND NEW.is_available AND NEW.deleted_at IS NULL THEN
      event_name := 'item_back_in_stock';
    ELSIF TG_OP = 'UPDATE' AND NEW.price_kobo < OLD.price_kobo THEN
      event_name := 'price_drop';
    ELSE RETURN NEW;
    END IF;
    event_payload := jsonb_build_object(
      'name', NEW.name, 'price_kobo', NEW.price_kobo,
      'previous_price_kobo', CASE WHEN TG_OP = 'UPDATE' THEN OLD.price_kobo ELSE NULL END,
      'image_url', NEW.image_url
    );
  ELSIF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP <> 'UPDATE'
       OR NEW.status <> 'COMPLETED'
       OR OLD.status = 'COMPLETED'
       OR NEW.payment_status <> 'PAID' THEN RETURN NEW;
    END IF;
    event_name := 'order_completed';
    entity_id := NEW.id::text; event_vendor_id := NEW.vendor_id;
    event_city_id := NEW.city_id; event_zone_id := NEW.zone_id;
    event_payload := jsonb_build_object('order_id', NEW.id);
  ELSE
    RETURN NEW;
  END IF;

  event_key_value := TG_TABLE_NAME || ':' || event_name || ':' || entity_id ||
    ':' || COALESCE(NEW.updated_at::text, NOW()::text);
  INSERT INTO feed_automation_outbox (
    event_key, event_type, source_entity_type, source_entity_id,
    vendor_id, city_id, zone_id, payload
  ) VALUES (
    event_key_value, event_name, TG_TABLE_NAME, entity_id,
    event_vendor_id, event_city_id, event_zone_id, event_payload
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Feed supply must never abort approval, inventory, checkout or payment.
  RAISE WARNING 'feed outbox enqueue failed for %.%: %', TG_TABLE_NAME, entity_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendors_feed_automation_event ON vendors;
CREATE TRIGGER vendors_feed_automation_event AFTER UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION enqueue_marketplace_feed_event();
DROP TRIGGER IF EXISTS menu_items_feed_automation_event ON menu_items;
CREATE TRIGGER menu_items_feed_automation_event AFTER INSERT OR UPDATE ON menu_items
FOR EACH ROW EXECUTE FUNCTION enqueue_marketplace_feed_event();
DROP TRIGGER IF EXISTS orders_feed_automation_event ON orders;
CREATE TRIGGER orders_feed_automation_event AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION enqueue_marketplace_feed_event();

CREATE OR REPLACE FUNCTION protect_lumex_official_profile()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The official LumeX Fud account cannot be deleted';
  END IF;
  IF COALESCE(current_setting('request.jwt.claim.role', TRUE), '') <> 'service_role' THEN
    RAISE EXCEPTION 'The official LumeX Fud account is system protected';
  END IF;
  IF NEW.system_account_key IS DISTINCT FROM 'lumex_fud'
     OR NEW.handle IS DISTINCT FROM OLD.handle
     OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NOT NEW.is_system_account
     OR NOT NEW.is_verified
     OR NEW.official_badge_kind IS DISTINCT FROM 'official' THEN
    RAISE EXCEPTION 'Protected official account identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS social_profiles_protect_lumex_identity ON social_profiles;
CREATE TRIGGER social_profiles_protect_lumex_identity
BEFORE UPDATE OR DELETE ON social_profiles
FOR EACH ROW WHEN (OLD.system_account_key = 'lumex_fud')
EXECUTE FUNCTION protect_lumex_official_profile();

ALTER TABLE feed_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_feed_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_automation_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_generation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_post_pins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON feed_automation_settings, vendor_feed_automation_settings,
  feed_automation_outbox, feed_generation_audit, feed_post_pins FROM anon, authenticated;
GRANT ALL ON feed_automation_settings, vendor_feed_automation_settings,
  feed_automation_outbox, feed_generation_audit, feed_post_pins TO service_role;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'official_feed_posts'::regclass
      AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%collection_type IN (%'
  LOOP
    EXECUTE format('ALTER TABLE official_feed_posts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE official_feed_posts ADD CONSTRAINT official_feed_posts_collection_type_ck
CHECK (collection_type IN (
  'new_on_lumex','lumex_picks','morning_collection','evening_collection',
  'breakfast_picks','lunch_picks','dinner_picks','student_budget',
  'open_right_now','closing_soon','rice_lovers','shawarma_picks',
  'pizza_friday','drinks_around_you','fast_delivery_picks','new_vendors',
  'new_menus_week','active_deals','sponsored','event',
  'cheap_eats','breakfast_collection','lunch_collection','evening_collection',
  'late_night_collection','popular_near_you','back_in_stock','order_activity_collection'
));
