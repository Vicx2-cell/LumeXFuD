-- LumeX Fud — durable transactional-email idempotency and welcome marker.
-- This migration does not backfill or send email to existing customers.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS transactional_email_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key     TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('WELCOME','ORDER_CONFIRMATION','ORDER_STATUS')),
  recipient     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','SENT','FAILED','SKIPPED')),
  attempt_count INT NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  resend_id     TEXT,
  error_code    TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactional_email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE transactional_email_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION claim_transactional_email_event(
  p_event_key TEXT,
  p_kind TEXT,
  p_recipient TEXT
) RETURNS TABLE(event_id UUID, claimed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO transactional_email_events(event_key, kind, recipient)
  VALUES (p_event_key, p_kind, lower(trim(p_recipient)))
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, TRUE;
    RETURN;
  END IF;

  UPDATE transactional_email_events
     SET status = 'PROCESSING', attempt_count = attempt_count + 1,
         error_code = NULL, updated_at = NOW()
   WHERE event_key = p_event_key
     AND recipient = lower(trim(p_recipient))
     AND status = 'FAILED'
  RETURNING id INTO v_id;

  RETURN QUERY SELECT COALESCE(v_id, (SELECT id FROM transactional_email_events WHERE event_key = p_event_key)), v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION finish_transactional_email_event(
  p_event_id UUID,
  p_status TEXT,
  p_resend_id TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('SENT','FAILED','SKIPPED') THEN
    RAISE EXCEPTION 'invalid transactional email status';
  END IF;
  UPDATE transactional_email_events
     SET status = p_status, resend_id = p_resend_id,
         error_code = left(p_error_code, 100),
         sent_at = CASE WHEN p_status = 'SENT' THEN NOW() ELSE sent_at END,
         updated_at = NOW()
   WHERE id = p_event_id AND status = 'PROCESSING';
END;
$$;

REVOKE ALL ON FUNCTION claim_transactional_email_event(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finish_transactional_email_event(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_transactional_email_event(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION finish_transactional_email_event(UUID, TEXT, TEXT, TEXT) TO service_role;
