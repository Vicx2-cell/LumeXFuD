-- ============================================================
-- LumeX Fud — Migration 039: AI dispute concierge
-- ============================================================
-- When a customer reports a problem, Lumi (the AI companion) does two things at
-- once and we persist both on the dispute row:
--   • ai_customer_reply — the warm, empathetic message shown to the student.
--   • ai_triage         — an impartial brief for the human admin (the same shape
--                         as the existing on-demand analyst), so the admin sees
--                         a recommendation the instant the dispute lands and can
--                         resolve in one informed click.
--
-- IMPORTANT: this is ADVISORY + INTAKE only. No money moves automatically — a
-- human still clicks Refund / No action (every refund stays audited, per the
-- non-negotiable money rules). customer_photo_url already exists on the table.
--
-- Idempotent.
-- ============================================================

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS ai_customer_reply TEXT,
  ADD COLUMN IF NOT EXISTS ai_triage         JSONB,
  ADD COLUMN IF NOT EXISTS ai_triaged_at      TIMESTAMPTZ;
