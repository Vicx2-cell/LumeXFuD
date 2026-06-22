-- ============================================================
-- LumeX Fud — Migration 074: separate WhatsApp number vs call number
-- ============================================================
-- The account `phone` is the WhatsApp number — it backs OTP, login, and every
-- wa.me contact deep link, so WhatsApp reachability is required. Some users want
-- a DIFFERENT number to be CALLED on (a second line, or a number that takes calls
-- but not WhatsApp). `call_phone` holds that optional call number.
--
--   call_phone IS NULL  → "same as WhatsApp": callers fall back to `phone`.
--   call_phone set       → tel: links use this; wa.me links always use `phone`.
--
-- E.164 (+234…), validated in the API like `phone`. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE customers ADD COLUMN IF NOT EXISTS call_phone TEXT;
ALTER TABLE vendors   ADD COLUMN IF NOT EXISTS call_phone TEXT;
ALTER TABLE riders    ADD COLUMN IF NOT EXISTS call_phone TEXT;
