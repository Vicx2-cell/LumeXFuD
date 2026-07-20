# Payments & Paystack Integration

## Payment Channels (enable in Paystack dashboard)
- **Cards**: Visa, Mastercard, Verve
- **Bank Transfer**: OPay, Moniepoint, PalmPay, Kuda, all Nigerian banks
- **USSD**: For students without smartphones
- **NO cash on delivery** (Jumia Food died because of cash rejection)

## Order Creation Flow

### POST /api/orders
```json
Body: {
  vendor_id: string,
  items: Array<{ 
    menu_item_id: string, 
    quantity: number, 
    special_instructions?: string 
  }>,
  delivery_type: 'BIKE' | 'DOOR',
  delivery_address: string,
  delivery_instructions?: string,
  tip_amount?: number // in kobo
}
```

### Processing Steps
```
1. Verify auth (or guest with phone)
2. Validate vendor: exists, is_active, status='OPEN' (or 'BUSY')
3. Validate cart: all items belong to vendor, all available, daily limits not exceeded
4. SERVER-SIDE PRICE CALCULATION — never trust client amounts:
   - subtotal = sum(menu_item.price * quantity for each item)
   - platform_markup = settings.platform_markup (₦250)
   - delivery_fee = settings.bike_fee (₦500) OR settings.door_fee (₦1,000)
   - tip = clamp(body.tip_amount, 0, 50000)
   - total = subtotal + platform_markup + delivery_fee + tip
5. Generate order number: LXF-{YEAR}-{6-digit}
6. Generate idempotency key (UUID)
7. Initialize Paystack transaction:
   - amount: total (in kobo)
   - email: phone + '@lumex.fud' (Paystack requires email)
   - reference: order number
   - metadata: order_id, customer_phone, vendor_id
   - split: configure subaccount split (vendor gets subtotal, platform gets rest)
   - callback_url: APP_URL + '/order/' + order_number
8. INSERT order with status='PENDING_PAYMENT', store all amounts in kobo
9. INSERT order_items snapshot (capture name + price at time of order)
10. Return { order_number, paystack_authorization_url, access_code }
```

## Paystack Webhook (CRITICAL)

### POST /api/paystack/webhook
This is the most security-critical endpoint in the app.

```
1. READ raw body BEFORE parsing JSON (HMAC verification needs raw bytes)
2. VERIFY HMAC signature using PAYSTACK_WEBHOOK_SECRET:
   const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
   if (hash !== req.headers['x-paystack-signature']) return 400;
3. PARSE body as JSON
4. Extract event reference: data.reference
5. CHECK idempotency: SELECT 1 FROM processed_webhooks WHERE reference = $1 AND event = $2
   - If exists: return 200 immediately (don't reprocess)
6. INSERT into processed_webhooks (race-condition safe with UNIQUE constraint)
7. RETURN 200 to Paystack IMMEDIATELY (within 30 seconds is required)
8. PROCESS event ASYNC (don't block the response)
```

### Event Handlers
```
CASE 'charge.success':
  - UPDATE order: payment_status='SUCCESS', status='PENDING' (vendor needs to accept)
  - Send Sendchamp WhatsApp to vendor: "New order #XXX! Accept in 5 mins."
  - Set vendor 5-min auto-cancel timer (cron picks this up)

CASE 'charge.failed':
  - UPDATE order: payment_status='FAILED', status='CANCELLED'
  - Send Sendchamp notification to customer: "Payment didn't go through. Your cart is saved — try again?"

CASE 'transfer.success':
  - Find wallet_transaction by paystack_transfer_code
  - UPDATE wallet_transaction: status='COMPLETED'
  - Send WhatsApp to user

CASE 'transfer.failed':
  - Find wallet_transaction by paystack_transfer_code
  - UPDATE wallet_transaction: status='FAILED', failure_reason
  - Refund balance to user's wallet
  - Send WhatsApp to user + alert admin

CASE 'transfer.reversed':
  - Find wallet_transaction
  - Reverse the withdrawal: credit balance back
  - WhatsApp user + admin alert

CASE 'refund.processed':
  - UPDATE refund record: status='COMPLETED'
  - Send WhatsApp to customer

CASE 'refund.failed':
  - UPDATE refund: status='FAILED'
  - Alert admin (URGENT)
```

## Refund Flow

### POST /api/paystack/refund
Admin-triggered only. Used when dispute resolved in customer's favor.

```json
Body: { 
  order_id: string, 
  reason: string, 
  amount?: number 
}
```

### Processing Steps
```
1. Verify admin role (or super admin)
2. Look up order, get Paystack transaction reference
3. Validate: refund.amount <= order.total_amount
4. Default amount = order.total_amount (full refund)
5. Call Paystack Refund API:
   POST https://api.paystack.co/refund
   { transaction: reference, amount: amount, currency: 'NGN' }
6. INSERT refunds record: status='PROCESSING'
7. UPDATE order: status='REFUNDED'
8. Audit log
9. Send WhatsApp to customer: "Refund of ₦X being processed. Should arrive in 24 hours."
10. Webhook will finalize (refund.processed event)
```

## Vendor Subscription Payment

### POST /api/vendors/subscription/pay
```
1. Verify vendor auth
2. Determine subscription amount based on vendor tier
3. Initialize Paystack transaction:
   - amount: subscription_amount (kobo)
   - reference: 'SUB-' + vendor_id + '-' + timestamp
   - metadata: { type: 'SUBSCRIPTION', vendor_id }
4. Return paystack_authorization_url
5. On webhook charge.success with metadata.type='SUBSCRIPTION':
   - INSERT vendor_subscriptions record (paid_at, period_start, period_end)
   - UPDATE vendors: subscription_paid_until = period_end
   - WhatsApp confirmation to vendor
```

## Grace Period Logic

### Cron Job: subscription-check (daily 9am)
```
1. Find vendors where subscription_paid_until < NOW()
2. For each:
   - days_overdue = (NOW - subscription_paid_until).days
   - If days_overdue === 1: WhatsApp "Your subscription expired. Pay to stay active."
   - If days_overdue === 2: WhatsApp "Second reminder."
   - If days_overdue === 3: WhatsApp "FINAL: Platform access ends tonight."
   - If days_overdue >= 4: UPDATE is_active = FALSE, hide from customers
```

## Critical Security Rules

1. **NEVER** trust client amounts. All prices calculated server-side from menu_items table.
2. **ALWAYS** verify HMAC. Without it, anyone can fake a payment notification.
3. **ALWAYS** check idempotency. Paystack retries webhooks if they don't get 200 fast enough.
4. **ALWAYS** return 200 within 30 seconds. Process async if needed.
5. **NEVER** use `===` for HMAC comparison. Use `crypto.timingSafeEqual`.
6. **NEVER** log full reference numbers or transaction codes to general logs (audit_logs only).

## HMAC Verification Example

```typescript
import crypto from 'crypto';

function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET!;
  const hash = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison (timing attack prevention)
  if (hash.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}
```

## Database Schema

### processed_webhooks
```sql
CREATE TABLE processed_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  event TEXT NOT NULL,
  payload JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reference, event)
);

CREATE INDEX idx_processed_webhooks_lookup ON processed_webhooks(reference, event);
```

### refunds
```sql
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id),
  paystack_transaction_reference TEXT NOT NULL,
  paystack_refund_reference TEXT,
  amount BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','COMPLETED','FAILED','NEEDS_ATTENTION')),
  triggered_by TEXT NOT NULL, -- admin user_id
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### vendor_subscriptions
```sql
CREATE TABLE vendor_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  amount BIGINT NOT NULL,
  paystack_reference TEXT UNIQUE NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED'))
);

CREATE INDEX idx_vendor_subs_vendor ON vendor_subscriptions(vendor_id, period_end DESC);
```
