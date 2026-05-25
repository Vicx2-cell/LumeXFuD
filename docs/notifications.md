# Termii Notifications (WhatsApp + SMS)

## Configuration
- **WhatsApp**: Primary channel for most notifications (cheaper, richer media)
- **SMS**: Used exclusively for OTP (universal reach, faster delivery for critical auth)
- **Sender ID**: `LumeXFud` (must be pre-approved by Termii)

## Notification Service Pattern

```typescript
// lib/termii/index.ts
import { normalizePhone } from '../phone'; // E.164 normalization
import { db } from '../supabase/client'; // Or server client, depending on context
import { termiiClient } from './init'; // Initialized Termii client

interface NotificationParams {
  to: string;
  channel?: 'whatsapp' | 'sms' | 'push';
  template: string;
  payload: Record<string, any>;
  user_id: string; // ID of the recipient user
  user_type: 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'ADMIN' | 'SUPER_ADMIN';
}

// Placeholder for template rendering logic
function renderTemplate(template: string, payload: Record<string, any>): string {
  // In a real app, this would use a proper templating engine
  let message = template;
  for (const key in payload) {
    message = message.replace(new RegExp(`{${key}}`, 'g'), payload[key]);
  }
  return message;
}

export async function sendNotification({
  to, channel = 'whatsapp', template, payload, user_id, user_type
}: NotificationParams) {
  const phone = normalizePhone(to);

  try {
    const result = await termiiClient.send({ to: phone, message: renderTemplate(template, payload), channel });

    await db.notifications.insert({
      user_id,
      user_type,
      channel,
      template,
      payload,
      status: 'SENT',
      termii_id: result.message_id,
      sent_at: new Date().toISOString()
    });

    return result;
  } catch (err: any) {
    await db.notifications.insert({
      user_id,
      user_type,
      channel,
      template,
      payload,
      status: 'FAILED',
      error: err.message,
      created_at: new Date().toISOString()
    });
    throw err;
  }
}
```

## Complete Template List

### Order Lifecycle

- **ORDER_PENDING** (→ vendor)
  ```
  📦 New order #LXF-2026-XXXXXX! ₦{total} from {customer_first_name}.
  Items: {items_summary}
  Accept within 5 minutes or it auto-cancels.
  Open dashboard: {dashboard_url}
  ```
- **VENDOR_ACCEPTED** (→ customer)
  ```
  ✅ Order confirmed! {vendor_name} is preparing your food.
  ETA: {arrival_time}
  Track here: {tracking_url}
  ```
- **ORDER_READY** (→ rider, when rider goes online OR broadcast)
  ```
  🚨🚨 Delivery available!
  Pickup: {vendor_name}
  Drop: {hostel}
  Pay: ₦{rider_cut}
  Open app to accept.
  ```
- **RIDER_ASSIGNED** (→ customer)
  ```
  🏍️ {rider_first_name} is on the way to pick up your food.
  ETA: {arrival_time}
  Track: {tracking_url}
  ```
- **PICKED_UP** (→ customer)
  ```
  🏃 Your food is on the way!
  {rider_first_name} should arrive by {arrival_time}.
  Call rider: {rider_phone}
  ```
- **DELIVERED** (→ customer)
  ```
  ✅ Food delivered!
  Confirm receipt or report a problem: {confirm_url}
  This auto-closes in 15 minutes.
  ```
- **COMPLETED** (→ rider)
  ```
  💰 ₦{amount} added to your wallet from delivery #LXF-2026-XXXXXX.
  Available for withdrawal in {hours} hours.
  Great job!
  ```
- **DISPUTED** (→ admin, URGENT)
  ```
  ‼️‼️ DISPUTE on #LXF-2026-XXXXXX
  Reason: {dispute_reason}
  Customer: {customer_phone}
  Vendor: {vendor_name}
  Review now: {admin_url}
  ```
- **CANCELLED** (→ customer)
  ```
  ❌ Your order #LXF-2026-XXXXXX was cancelled.
  Reason: {cancellation_reason}
  No charge was made to your account.
  ```

### Wallet Events

- **WITHDRAWAL_SUCCESS** (→ user)
  ```
  💰 ₦{amount} sent to your {bank_name} account ({last_4}).
  Transaction ref: {reference}
  Should arrive within 5 minutes.
  ```
- **WITHDRAWAL_FAILED** (→ user)
  ```
  ❌ Withdrawal of ₦{amount} failed.
  Reason: {failure_reason}
  Balance refunded to your wallet.
  Try again or contact support.
  ```
- **BANK_ADDED** (→ user)
  ```
  💳 New bank account added: {bank_name} - {last_4}
  For security, withdrawals to this account are locked for 24 hours.
  First withdrawal allowed at: {unlock_time}
  Wasn't you? Contact support immediately.
  ```
- **WALLET_FROZEN** (→ user)
  ```
  🥶 Your LumeX wallet has been temporarily frozen for review.
  This is for your protection.
  Contact support: {support_url}
  ```
- **WALLET_PIN_CHANGED** (→ user)
  ```
  🔑 Your wallet PIN was just changed.
  If this wasn't you, reset immediately: {reset_url}
  ```

### Subscription Events (Vendor)

- **SUBSCRIPTION_EXPIRY_DAY_1** (→ vendor)
  ```
  ⚠️ Your LumeX Fud subscription expired today.
  Pay ₦{amount} to keep accepting orders.
  Pay now: {pay_url}
  Grace period: 3 days.
  ```
- **SUBSCRIPTION_EXPIRY_DAY_2** (→ vendor)
  ```
  ‼️ Second reminder: subscription payment overdue.
  ₦{amount} - pay now to avoid deactivation: {pay_url}
  ```
- **SUBSCRIPTION_EXPIRY_DAY_3** (→ vendor)
  ```
  ⛔ FINAL WARNING: Your platform access ends tonight.
  Pay ₦{amount} now to stay active: {pay_url}
  After tonight, your shop will be hidden from customers.
  ```
- **SUBSCRIPTION_PAID** (→ vendor)
  ```
  ✅ Subscription paid. Active until {expiry_date}.
  Thank you for being part of LumeX Fud.
  ```
- **SUBSCRIPTION_DEACTIVATED** (→ vendor)
  ```
  ❌ Your subscription is overdue and your shop has been hidden from customers.
  Reactivate anytime: {pay_url}
  ```

### Refund Events

- **REFUND_INITIATED** (→ customer)
  ```
  ↩️ Your refund of ₦{amount} for order #LXF-2026-XXXXXX is being processed.
  Should arrive in your account within 24 hours.
  ```
- **REFUND_PROCESSED** (→ customer)
  ```
  ✅ Refund of ₦{amount} sent to your account.
  Order #LXF-2026-XXXXXX
  Sorry for the inconvenience.
  ```
- **REFUND_FAILED** (→ admin, URGENT)
  ```
  ❌ Refund failed for order #LXF-2026-XXXXXX
  Amount: ₦{amount}
  Reason: {failure_reason}
  Manual intervention needed: {admin_url}
  ```

### Security Events

- **NEW_DEVICE_LOGIN** (→ user)
  ```
  🚨 New device logged into your LumeX account.
  Device: {device_info}
  Location: {city}
  Time: {time}
  Wasn't you? Revoke access: {revoke_url}
  ```
- **SUSPICIOUS_ACTIVITY** (→ admin)
  ```
  🕵️ Suspicious activity detected
  User: {phone}
  Pattern: {pattern}
  IP: {ip}
  Review: {admin_url}
  ```
- **RECONCILIATION_MISMATCH** (→ admin, URGENT)
  ```
  ‼️ URGENT: Wallet reconciliation failed
  Total wallet balance: ₦{wallet_total}
  Paystack balance: ₦{paystack_balance}
  Difference: ₦{difference}
  All withdrawals frozen. Investigate immediately.
  ```
- **ADMIN_LOGIN** (→ super admin)
  ```
  🛡️ Admin {admin_name} logged in
  Device: {device}
  IP: {ip}
  Time: {time}
  ```
- **OTP_LOCKOUT** (→ user)
  ```
  🔒 Your account is temporarily locked due to too many OTP attempts.
  Try again in 30 minutes.
  If this wasn't you: {support_url}
  ```

### Gamification

- **STREAK_AT_RISK** (→ customer, only if streak >= 3)
  ```
  🔥 Your {streak}-day streak ends tonight at midnight.
  Order anything to keep it alive: {app_url}
  You have {freezes} streak freeze remaining.
  ```
- **STREAK_BROKEN** (→ customer, only if previous streak >= 7)
  ```
  💔 Your {streak}-day streak ended.
  Order today to start a new one: {app_url}
  ```
- **BADGE_EARNED** (→ customer)
  ```
  🏅 New badge earned: {badge_emoji} {badge_name}!
  {badge_description}
  +{xp} XP
  Check your profile: {profile_url}
  ```
- **LEVEL_UP** (→ customer)
  ```
  ✨ Level up! You are now: {new_level}
  Total XP: {total_xp}
  Keep ordering to unlock the next level.
  ```
- **WEEKLY_LEADERBOARD_TOP_3** (→ customer, Mondays)
  ```
  🏆 You finished #{rank} on the weekly leaderboard!
  XP earned: {weekly_xp}
  This week's leaderboard resets now — keep ordering!
  ```

### Order Messages (Fallback)

- **MESSAGE_UNREAD_5MIN** (→ recipient)
  ```
  💬 {sender_name} sent a message about order #LXF-2026-XXXXXX:
  '{message_preview}'
  Reply: {order_url}
  ```

### Customer Marketing (V2, opt-in only)

- **WE_MISS_YOU** (→ customer who hasn't ordered in 7 days)
  ```
  🥺 We miss you at LumeX Fud!
  Your last order: {last_item} from {vendor_name}
  Order again: {reorder_url}
  ```
- **NEW_VENDOR** (→ active customers, opt-in only)
  ```
  🎉 New on LumeX Fud: {vendor_name}
  Speciality: {vendor_specialty}
  Check them out: {vendor_url}
  ```

## Notifications Database Schema

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SUPER_ADMIN')),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','push')),
  template TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','DELIVERED','READ','FAILED')),
  termii_id TEXT,
  error TEXT,
  retry_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_pending ON notifications(status, retry_count) 
  WHERE status = 'PENDING';
```

## Retry Logic
Failed notifications retry up to 3 times with exponential backoff:
- **1st retry**: after 30 seconds
- **2nd retry**: after 2 minutes
- **3rd retry**: after 10 minutes
- **After 3rd failure**: Mark as `FAILED_PERMANENTLY` and alert admin. No further retries.

### Rider Notifications

#### Order Events
- **Order Available**: "🎯 Order ready for pickup! Pick up from [Vendor]. Pays ₦[amount]."
- **Order Assigned**: "✅ Order assigned to you! Pick up from [Vendor]."
- **Pickup Reminder**: "📍 Customer waiting. ETA to pickup?"
- **Delivery Reminder**: "🏁 Customer waiting for delivery!"

#### Wallet Events
- **Daily Payout**: "💰 Daily payout of ₦4,500 processed. Check your wallet!"
- **Payment On Hold**: "Payment on hold (released after 24hrs). Current: ₦12,000."

#### Performance Events
- **Rating Update**: "Your rating updated to 4.6 (from 4.7). You're still awesome!"
- **Tier Upgrade**: "🎉 Reached Gold tier! Now earn ₦20,000/day withdrawal limit!"

### Admin Notifications (WhatsApp only)

#### Urgent Events
- **Reconciliation Mismatch**: "🚨 CRITICAL: Wallet mismatch detected! ₦50,000 diff. Investigate NOW."
- **High Dispute Rate**: "⚠️ Dispute rate hit 5.2% (target: 3%). Investigate immediately."
- **High Cancellation Rate**: "⚠️ Auto-cancel rate 25% (target: < 10%). Check vendors."
- **Payment Failed**: "🚨 Large payment failed: order LXF-2026-XXXXX ₦15,000. Check Paystack."

## Template Examples

### Order Confirmation
```
Template: order_confirmed
Variables: order_number, vendor_name, total_amount, wait_time
Message: "Your order {{order_number}} confirmed! {{vendor_name}} preparing now. Est. wait: {{wait_time}} mins. 📦"
```

### Rider Assignment
```
Template: rider_assigned
Variables: rider_name, rider_phone, eta, vehicle
Message: "Your rider {{rider_name}} assigned! 📍 {{eta}} mins away. {{vehicle}}. {{rider_phone}}"
```

## Scheduling

### Immediate (within 30 seconds)
- New order confirmation
- Rider assignment
- Delivery confirmation
- Dispute notifications

### Batch (hourly)
- Daily summaries
- Low-priority alerts
- Promotional messages

### Scheduled
- Subscription reminders (3 days before due date)
- Reorder suggestions (Thursdays at 5pm)

## Termii Integration

### API Configuration
- Use Termii Send WhatsApp endpoint for primary channel
- Fallback to SMS endpoint if WhatsApp fails
- Max 160 chars for SMS, up to 1000 for WhatsApp
- Rate limit: 100 msgs/min per account

### Sending Flow
```
1. Create notification record with status PENDING
2. Call Termii WhatsApp API
3. Get message_id from response
4. Update notification with message_id and status SENT
5. Poll for delivery status (via webhook if supported)
6. Update notification with status DELIVERED or FAILED
7. If failed and not SMS: retry with SMS
8. Log to notifications table
```

## Opt-Out & Preferences

### Customer Settings
- Can disable certain notification types
- Can set quiet hours (e.g., 10pm-8am)
- Can choose WhatsApp, SMS, or both
- Cannot opt out of critical orders

### Admin Settings
- Only critical alerts (no opt-out)
- WhatsApp only (no SMS for security)

## Database Tables
- `notifications` - Sent notifications with status
- `notification_templates` - Message templates
- `notification_preferences` - User opt-outs

## Security Rules
- NEVER send sensitive data in messages (full phone numbers, bank details, tokens)
- Truncate or mask: phone → **8012345XXX
- Verify phone format before sending (E.164)
- Log failed messages for audit trail
- NEVER retry more than 3 times (spam risk)
