-- ============================================================
-- LumeX Fud — Migration 021: Encrypt bank account numbers at rest
-- ============================================================
-- bank_account_number now stores AES-256-GCM ciphertext (see lib/crypto.ts).
-- A separate plaintext last-4 is kept for display so the UI never needs to
-- decrypt. Existing plaintext rows keep working (decryptField returns
-- non-prefixed values as-is) until the user next saves their bank.
-- Idempotent.
-- ============================================================

ALTER TABLE wallet_balances
  ADD COLUMN IF NOT EXISTS bank_account_last4 TEXT;

-- Backfill last-4 for any rows that still hold a plaintext 10-digit NUBAN.
UPDATE wallet_balances
SET bank_account_last4 = RIGHT(bank_account_number, 4)
WHERE bank_account_last4 IS NULL
  AND bank_account_number ~ '^[0-9]{10}$';
