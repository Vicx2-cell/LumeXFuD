# Payments System

## Overview
Paystack integration for Cards, Bank Transfer, and USSD payments

## Subsystems
- Payment initialization
- Webhook handling
- Idempotency tracking
- Refunds and reversals
- Subscription billing
- Payment holds (24hr rider, 3-day vendor)

## Key Routes
- `POST /api/paystack/webhook` - Webhook receiver (HMAC verified)
- `POST /api/paystack/refund` - Process refund
- `POST /api/paystack/subscription` - Handle subscription payment

## Payment Flow

### Order Payment
```
1. Customer creates order
2. Calculate total: food + platform fee (₦250) + delivery fee
3. Initialize Paystack charge via api.paystack.co
4. Return authorization_url to customer
5. Customer completes payment on Paystack
6. Paystack sends webhook to /api/paystack/webhook
7. Verify HMAC signature with PAYSTACK_WEBHOOK_SECRET
8. Check processed_webhooks table for idempotency
9. Insert payment record with status PENDING
10. Update order status to PAYMENT_CONFIRMED
11. Notify vendor via browser Notification API + Termii
12. Return 200 OK to Paystack within 30 seconds
13. Process async: mark as COMPLETED
```

### Webhook Handling
```
Every webhook must:
1. Verify HMAC: HMAC-SHA512(event, PAYSTACK_WEBHOOK_SECRET)
2. Check idempotency_key in processed_webhooks table
3. Mark as processed BEFORE processing
4. Handle async without blocking
5. Return 200 within 30 seconds
```

## Key Events
- `charge.success` - Payment succeeded
- `charge.failed` - Payment failed → auto-cancel order
- `subscription.create` - Vendor subscription started
- `subscription.disable` - Vendor subscription ended

## Refund Types
- **Customer Dispute Win**: Full order refund → customer wallet
- **Vendor-Initiated**: Partial/full refund for order issues
- **Payment Failure**: Automatic if order not confirmed
- **Admin Override**: Super admin can refund from UI

### Refund Flow
```
1. Create refund record with reason
2. Log to audit_logs
3. Call Paystack Transfer API for customer refund
4. Call Paystack Refund API for vendor reversal if needed
5. Update order status if applicable
6. Notify customer + vendor via WhatsApp
7. Wait for Paystack confirmation
8. Mark refund COMPLETED in DB
```

## Pricing (Read from settings table, never hardcode)
- Platform markup: ₦250 per order
- Bike delivery: ₦500 (rider ₦400, platform ₦100)
- Door delivery: ₦1,000 (rider ₦800, platform ₦200)
- Minimum order: ₦500
- Paystack processing fee: ~1.5% + ₦100 per transaction (passed to customer)

## Payment Holds
- **Rider**: 24 hours after DELIVERED status
- **Vendor**: 3 days after order COMPLETED
- Release via cron: `POST /api/cron/release-payments` (runs every minute)

## Database Tables
- `payments` - All payment records
- `refunds` - Refund tracking
- `processed_webhooks` - Idempotency check (webhook_id, processed_at)
- `wallet_transactions` - Refund records in wallet
- `vendor_subscriptions` - Subscription billing

## Security Rules
- ALWAYS verify Paystack HMAC before processing
- ALWAYS check idempotency before processing webhook
- ALWAYS calculate prices server-side (never trust client)
- ALWAYS return 200 to Paystack within 30 seconds
- NEVER expose Paystack secret key in client code
- Failed payments → automatic order cancellation
