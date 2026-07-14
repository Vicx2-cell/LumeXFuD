-- LumeX Fud - Migration 115: extend protected official feed collections

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'official_feed_posts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%collection_type IN (%'
  LOOP
    EXECUTE format('ALTER TABLE official_feed_posts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE official_feed_posts
  ADD CONSTRAINT official_feed_posts_collection_type_ck
  CHECK (collection_type IN (
    'new_on_lumex',
    'lumex_picks',
    'morning_collection',
    'evening_collection',
    'breakfast_picks',
    'lunch_picks',
    'dinner_picks',
    'student_budget',
    'open_right_now',
    'closing_soon',
    'rice_lovers',
    'shawarma_picks',
    'pizza_friday',
    'drinks_around_you',
    'fast_delivery_picks',
    'new_vendors',
    'new_menus_week',
    'active_deals',
    'sponsored',
    'event'
  ));
