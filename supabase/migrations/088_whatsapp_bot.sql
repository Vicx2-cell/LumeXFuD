-- ============================================================
-- LumeX Fud — Migration 088: WhatsApp Cloud API bot
-- ============================================================
-- Self-contained tables backing the WhatsApp Cloud API bot:
--   • whatsapp_conversations — per-phone bot state machine + cart + bot|human mode
--   • whatsapp_applications  — vendor/rider sign-up capture from chat
--   • whatsapp_messages      — inbound/outbound message log (+ inbound dedupe)
--
-- Like the rest of the platform (mirrors migration 054), RLS is enabled and
-- denied for client roles (anon/authenticated). Real auth is enforced in
-- API-route code and every read/write goes through the service role (which
-- bypasses RLS). RLS here is a belt-and-braces deny — never a client surface.
--
-- Idempotent. Does NOT touch or migrate any existing table data.
-- ============================================================

-- ─── whatsapp_conversations ──────────────────────────────────────────────────
-- One row per WhatsApp phone (canonical E.164 with leading +, as produced by
-- lib/phone.ts normalizePhone). `cart` holds the in-progress order:
--   {"vendor_id": "...", "items": [{"menu_item_id","name","price_kobo","qty"}]}
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  phone           TEXT PRIMARY KEY,                       -- canonical E.164 (+234...)
  role            TEXT,                                    -- customer|vendor|rider|unknown (last resolved)
  state           TEXT NOT NULL DEFAULT 'IDLE',            -- ordering state machine cursor
  cart            JSONB NOT NULL DEFAULT '{}'::jsonb,      -- {vendor_id, items:[...]}
  active_order_id UUID REFERENCES orders(id),
  mode            TEXT NOT NULL DEFAULT 'bot'
                    CHECK (mode IN ('bot','human')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny client whatsapp_conversations" ON whatsapp_conversations;
CREATE POLICY "deny client whatsapp_conversations" ON whatsapp_conversations
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Fast lookup of conversations needing a human (admin inbox).
CREATE INDEX IF NOT EXISTS idx_wa_conversations_mode
  ON whatsapp_conversations (mode, updated_at DESC);

-- ─── whatsapp_applications ───────────────────────────────────────────────────
-- Captures "Become a vendor / rider" leads from chat for follow-up.
CREATE TABLE IF NOT EXISTS whatsapp_applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,                              -- canonical E.164
  kind        TEXT NOT NULL CHECK (kind IN ('vendor','rider')),
  name        TEXT,                                       -- WhatsApp profile name, if any
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'NEW'
                CHECK (status IN ('NEW','CONTACTED','APPROVED','REJECTED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE whatsapp_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny client whatsapp_applications" ON whatsapp_applications;
CREATE POLICY "deny client whatsapp_applications" ON whatsapp_applications
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_wa_applications_status
  ON whatsapp_applications (status, created_at DESC);

-- ─── whatsapp_messages ───────────────────────────────────────────────────────
-- Inbound + outbound log. `wa_message_id` is Meta's message id; the partial
-- unique index makes the inbound insert idempotent (Meta RETRIES webhooks, so
-- we dedupe on it before processing).
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL,                            -- the peer (customer/vendor/rider)
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  wa_message_id TEXT,                                     -- Meta message id (inbound dedupe)
  msg_type      TEXT,                                     -- text|interactive|button|image|...
  body          TEXT,                                     -- rendered text / button id
  payload       JSONB,                                    -- raw message object
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny client whatsapp_messages" ON whatsapp_messages;
CREATE POLICY "deny client whatsapp_messages" ON whatsapp_messages
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Inbound dedupe: at most one inbound row per Meta message id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_inbound_id
  ON whatsapp_messages (wa_message_id)
  WHERE direction = 'in' AND wa_message_id IS NOT NULL;

-- Thread fetch for the admin inbox.
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone_time
  ON whatsapp_messages (phone, created_at);

-- ─── orders.payment_method: allow MANUAL (WhatsApp manual-pilot orders) ───────
-- WhatsApp orders are placed in "manual-pilot" mode: the vendor collects payment
-- directly (no Paystack split). Widen the existing CHECK so these orders carry a
-- truthful payment_method rather than being mislabelled 'PAYSTACK'. Idempotent:
-- drop the old constraint (whatever its generated name) and re-add with MANUAL.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'orders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%payment_method%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('PAYSTACK','WALLET','SPLIT','MANUAL'));
