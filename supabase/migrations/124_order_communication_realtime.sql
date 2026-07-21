-- ============================================================
-- LumeX Fud — Migration 124: realtime publication for order communication
-- Phase 4. The browser never receives the service key; an authenticated server
-- event stream relays only rows from its already-authorized conversation.
-- ============================================================

DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'order_conversations', 'order_messages', 'order_message_reads', 'orders'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
    END IF;
  END LOOP;
END;
$$;
