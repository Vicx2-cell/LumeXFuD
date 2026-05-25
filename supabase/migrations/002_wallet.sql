-- ============================================================
-- LumeX Fud — Migration 002: Wallet
-- ============================================================

-- ─── WALLET BALANCES ──────────────────────────────────────────────────────────
-- Composite PK (user_id, user_type) ensures one wallet per user per type
CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id           TEXT NOT NULL,
  user_type         TEXT NOT NULL CHECK (user_type IN ('VENDOR','RIDER')),
  total_balance     BIGINT NOT NULL DEFAULT 0,
  available_balance BIGINT NOT NULL DEFAULT 0,
  held_balance      BIGINT NOT NULL DEFAULT 0,
  trust_tier        TEXT NOT NULL DEFAULT 'BRONZE'
                      CHECK (trust_tier IN ('BRONZE','SILVER','GOLD','DIAMOND')),
  wallet_pin_hash   TEXT,          -- bcrypt hash, cost 12
  last_bank_added_at TIMESTAMPTZ,
  is_frozen         BOOLEAN DEFAULT FALSE,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, user_type)
);
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;

-- ─── WALLET TRANSACTIONS (immutable ledger) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  user_type             TEXT NOT NULL CHECK (user_type IN ('VENDOR','RIDER')),
  type                  TEXT NOT NULL
                          CHECK (type IN ('CREDIT','DEBIT','HOLD','RELEASE','FREEZE','WITHDRAWAL')),
  amount                BIGINT NOT NULL,
  balance_before        BIGINT NOT NULL,
  balance_after         BIGINT NOT NULL,
  reference             TEXT UNIQUE,
  order_id              TEXT,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  paystack_transfer_code TEXT,
  failure_reason        TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user
  ON wallet_transactions(user_id, user_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_pending
  ON wallet_transactions(status, created_at)
  WHERE status = 'PENDING';
