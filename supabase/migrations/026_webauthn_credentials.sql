-- ============================================================
-- LumeX Fud — Migration 026: WebAuthn (Face ID / Touch ID) credentials
-- ============================================================
-- Second-factor biometric login. After a correct PIN, a user who has registered
-- a passkey must also pass a WebAuthn assertion (Face ID / Touch ID / platform
-- authenticator) before a session is issued. Optional per user: no row here ⇒
-- PIN-only login as before.
--
-- public_key is stored ENCRYPTED at rest (lib/crypto.ts, AES-256-GCM). Public
-- keys are not secret, but encrypting gives tamper-detection on the value the
-- server trusts to verify assertions (defense in depth).
--
-- Service-role only: RLS is ON with NO policies, so anon/auth clients cannot
-- read or write (rule #23: never USING(true)). Only server code (service role,
-- which bypasses RLS) touches this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  user_role       text NOT NULL CHECK (user_role IN ('customer','vendor','rider','admin','super_admin')),
  phone           text NOT NULL,
  -- base64url credential id from the authenticator (lookup key on login)
  credential_id   text NOT NULL UNIQUE,
  -- encrypted (enc:v1:...) base64url COSE public key bytes
  public_key      text NOT NULL,
  counter         bigint NOT NULL DEFAULT 0,
  transports      text[],
  device_label    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webauthn_phone   ON webauthn_credentials (phone);
CREATE INDEX IF NOT EXISTS idx_webauthn_user    ON webauthn_credentials (user_id, user_role);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: server-only table. Service role bypasses RLS;
-- everyone else is denied by default.

