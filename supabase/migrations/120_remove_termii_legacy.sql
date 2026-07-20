-- Remove the last legacy provider-specific notification field.
-- Fresh databases already use provider_message_id in migration 007; existing
-- databases are renamed in place so any historical message IDs are preserved.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_logs'
      AND column_name = 'termii_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_logs'
      AND column_name = 'provider_message_id'
  ) THEN
    ALTER TABLE public.notification_logs
      RENAME COLUMN termii_id TO provider_message_id;
  END IF;
END $$;
