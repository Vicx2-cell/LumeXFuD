# LumeX Wallet System

## Overview
Financial infrastructure of the platform. NOT just a payout feature. Build with the same seriousness as a bank — other people's money is inside.

## Hold Periods (current model — migration 057, see lib/wallet.ts)
Earnings are credited to the wallet as HELD when an order completes, then released
to AVAILABLE after a short hold. Base hold **5 hours** for both riders and vendors,
reduced by trust tier, and **floored at 1 hour** (so a hold is never zero — there's
always a window to lock/refund). All durations are live-tunable in `settings`
(`hold_*_minutes`). A refund claws the earnings back (held first, then available,
remainder as a debt repaid by future earnings). Admin can freeze any wallet instantly.

## Trust Tier System
Affects hold time. Recalculated live from completed orders/deliveries on every read.

| Tier | Criteria | Hold reduction | Resulting hold (5h base) |
|------|----------|----------------|--------------------------|
| Bronze | 0–49 orders/deliveries | 0% (standard) | ~5h |
| Silver | 50–199 | 50% faster | ~2½h |
| Gold | 200–499 | 75% faster | ~1¼h |
| Diamond | 500+, rating 4.8+ | floored | ~1h (the minimum) |

## Withdrawal Flow
1. User taps "Withdraw" — only AVAILABLE balance shown (hold expired)
2. Selects bank from dropdown (Paystack List Banks API)
3. Enters account number
4. Paystack Account Resolver verifies name — user confirms
5. Enter OTP (SMS) + 4-digit wallet PIN
6. System triggers Paystack Transfer API
7. Transfer logged to wallet_transactions and audit_logs
8. WhatsApp notification on success/failure

## Bank List (NEVER hardcode)
```
// Cache in Upstash Redis for 24 hours
GET https://api.paystack.co/bank?country=nigeria
```
Covers OPay, Moniepoint, PalmPay, Kuda, GTBank, Access, Zenith — automatically.

## Withdrawal Limits
- Minimum: ₦500
- Maximum per transaction: ₦25,000
- Maximum per day: ₦50,000
- Maximum per week: ₦200,000
- Maximum per month: ₦500,000
- New bank account added → 24-hour cooling period
- 3+ withdrawal attempts in 1 hour → freeze + admin alert

## Fraud Protections
1. **Chargeback protection**: New students get extra 7-day hold on vendor/rider payouts for their first 100 orders
2. **Collusion protection**: New vendors AND riders get 30-day extended holds
3. **SIM swap protection**: Withdrawals require OTP + separate 4-digit PIN
4. **Bank swap protection**: New withdrawal bank → 24hr cooling + WhatsApp to OLD number
5. **Velocity fraud**: Cumulative daily/weekly/monthly limits
6. **Insider fraud**: Every admin freeze/unfreeze logged + WhatsApp alert

## API Routes

### GET /api/wallet/balance
```
1. Verify auth (vendor or rider role)
2. SELECT * FROM wallet_balances WHERE user_id = $1 AND user_type = $2
3. Return { total_balance, available_balance, held_balance, trust_tier }
```

### POST /api/wallet/withdraw
```json
Body: { amount, bank_code, account_number, otp, pin }
```

```
1. Verify auth
2. Validate amount: within tier limits
3. Verify wallet PIN (bcrypt compare)
4. Verify OTP (separate from login OTP)
5. Check new bank cooling period
6. Check daily/weekly/monthly limits (sum wallet_transactions)
7. BEGIN TRANSACTION
8. SELECT FOR UPDATE wallet_balances → verify available_balance >= amount
9. UPDATE wallet_balances: available_balance -= amount
10. INSERT wallet_transactions: type=WITHDRAWAL, status=PENDING
11. Call Paystack Transfer API
12. If success: UPDATE transaction to COMPLETED
13. If fail: UPDATE transaction to FAILED, refund balance
14. COMMIT
15. WhatsApp notification
16. Audit log
```

### GET /api/wallet/banks
```
1. Check Upstash Redis cache: key = "paystack:banks:nigeria"
2. If cache miss: call Paystack List Banks API, cache 24h
3. Return: [{ name, code, longcode }, ...]
```

### POST /api/wallet/verify-account
```json
Body: { account_number, bank_code }
```

```
1. Call Paystack Account Resolver API
2. Return account_name for user to confirm
3. NEVER save until user explicitly confirms in next step
```

### POST /api/wallet/set-pin
```json
Body: { pin: "1234", current_pin?: "xxxx" }
```

```
1. Verify auth
2. If wallet_pin_hash exists, require current_pin
3. Validate new PIN: exactly 4 digits, not sequential, not all same digit
4. bcrypt hash with cost factor 12
5. UPDATE wallet_balances SET wallet_pin_hash
6. Audit log
```

## Daily Reconciliation (CRITICAL — cron at 6am)
```
1. Sum all wallet_balances.total_balance
2. Get Paystack account balance via Paystack Balance API
3. If diverge by more than ₦100 →
   - WhatsApp alert to admin (URGENT)
   - Set platform_status to FROZEN_RECONCILIATION
   - All withdrawals reject with "Platform under maintenance"
4. Log result to audit_logs
5. If match: log success
```

## Database Schema

### wallet_balances
```sql
CREATE TABLE wallet_balances (
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('VENDOR','RIDER')),
  total_balance BIGINT NOT NULL DEFAULT 0,
  available_balance BIGINT NOT NULL DEFAULT 0,
  held_balance BIGINT NOT NULL DEFAULT 0,
  trust_tier TEXT NOT NULL DEFAULT 'BRONZE' CHECK (trust_tier IN ('BRONZE','SILVER','GOLD','DIAMOND')),
  wallet_pin_hash TEXT,
  last_bank_added_at TIMESTAMPTZ,
  is_frozen BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, user_type)
);
```

### wallet_transactions
```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CREDIT','DEBIT','HOLD','RELEASE','FREEZE','WITHDRAWAL')),
  amount BIGINT NOT NULL,
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reference TEXT UNIQUE,
  order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  paystack_transfer_code TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id, user_type, created_at DESC);
CREATE INDEX idx_wallet_tx_pending ON wallet_transactions(status, created_at) WHERE status = 'PENDING';
```

## Row-Level Security (RLS) Policies

```sql
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own wallet" ON wallet_balances
  FOR SELECT USING (
    (user_type = 'VENDOR' AND user_id IN (SELECT id FROM vendors WHERE phone = auth.jwt() ->> 'phone'))
    OR
    (user_type = 'RIDER' AND user_id IN (SELECT id FROM riders WHERE phone = auth.jwt() ->> 'phone'))
  );

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own transactions" ON wallet_transactions
  FOR SELECT USING (
    (user_type = 'VENDOR' AND user_id IN (SELECT id FROM vendors WHERE phone = auth.jwt() ->> 'phone'))
    OR
    (user_type = 'RIDER' AND user_id IN (SELECT id FROM riders WHERE phone = auth.jwt() ->> 'phone'))
  );
```

## Security Rules
1. **NEVER** mix platform operating money with wallet balances
2. **NEVER** expose bank account numbers to non-admins
3. Wallet operations bank account MUST be separate from personal account
4. **EVERY** action logged to wallet_transactions AND audit_logs
5. **EVERY** freeze/unfreeze triggers WhatsApp alert
6. 4-digit PIN required for withdrawals (hashed with bcrypt, cost factor 12)
7. Daily withdrawal limits enforced per tier
8. Reconciliation mismatch = immediate platform freeze
9. Failed withdrawals auto-refund to wallet
10. New bank account added → 24-hour cooling period
11. SELECT FOR UPDATE for all balance modifications (race condition prevention)
