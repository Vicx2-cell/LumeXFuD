# In-App Order Messaging

## Overview
Contextual message threads tied to active orders only. NOT a chat platform. NOT a social inbox. Three channels: Customer↔Vendor, Customer↔Rider, Customer↔Support. Purpose: keep all communication inside LumeX so users never switch apps.

## Who Can Message Who (server-side enforced)

| From | To | Window |
|------|----|----|
| Customer | Vendor | ORDER PLACED until READY |
| Customer | Rider | PICKED_UP until DELIVERED |
| Vendor | Customer | VENDOR_ACCEPTED until READY |
| Rider | Customer | RIDER_ASSIGNED until DELIVERED |
| Customer | Admin (Support) | Any time on active/disputed order |
| Admin | Anyone | Any time |

Reject messages outside allowed window with 403.

## Rules
- Max 300 characters per message
- No links allowed (strip URLs — fraud prevention)
- No phone numbers allowed (strip +234 or 0XX patterns)
- Rate limit: max 10 messages per user per order
- Profanity filter: flag for admin review, don't block
- Messages auto-read when recipient opens order page
- Messages permanent (needed for disputes)

## Real-Time Delivery
Supabase Realtime channel: `order-messages-{order_id}`
Subscribe on: order status page, vendor dashboard, rider dashboard

## WhatsApp Fallback
If unread after 5 minutes → send Termii WhatsApp:
- **To vendor**: "New message from customer on order #LXF-2026-XXXXXX: [preview]"
- **To customer**: "Your vendor sent a message: [preview]. Reply: [link]"
- **To rider**: "Customer sent a message: [preview]"

Log fallback to notifications table.

## UI
- Floating button on order status page: "💬 Message Vendor"
- Opens as bottom sheet (not new page) — stay on order status
- Sender labels: "You", "Belleful", "Emmanuel (Rider)", "LumeX Support"
- Timestamps + read receipts (single tick → double amber tick)
- Auto-scroll to latest message
- Keyboard pushes sheet up (mobile-first)
- Thread auto-closes when order COMPLETED or CANCELLED
- After complete: visible but locked ("This order is complete")

## API Routes

### POST /api/orders/[id]/messages
```json
Body: { 
  message: string, 
  recipient_type: 'VENDOR' | 'RIDER' | 'CUSTOMER' | 'ADMIN' 
}
```

```
1. Verify auth
2. Verify order ownership / role allowed
3. Check current order status allows this sender → recipient combo
4. Validate message: <= 300 chars, strip URLs, strip phone patterns
5. Profanity check: flag in audit_logs if matched
6. Rate limit: 10 messages per user per order
7. INSERT into order_messages
8. Trigger Supabase Realtime broadcast
9. Schedule WhatsApp fallback (5-min check)
10. Return inserted message
```

### GET /api/orders/[id]/messages
```
1. Verify auth
2. Verify order ownership / role
3. SELECT * FROM order_messages WHERE order_id = $1 ORDER BY created_at ASC
4. Return array of messages
```

### PATCH /api/orders/[id]/messages/read
```
1. Verify auth
2. UPDATE order_messages SET read_at = NOW()
   WHERE order_id = $1 AND recipient_type = (current user's type) AND read_at IS NULL
3. Return { marked_read: count }
```

## Database Schema

### order_messages
```sql
CREATE TABLE order_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','AI_SUPPORT')),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN')),
  message TEXT NOT NULL CHECK (char_length(message) <= 300),
  flagged_profanity BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_messages_order ON order_messages(order_id, created_at);
```

## Sanitization Functions

```typescript
// lib/messaging.ts
function stripUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/gi, '[link removed]')
    .replace(/www\.[^\s]+/gi, '[link removed]')
    .replace(/[a-z0-9-]+\.(com|ng|org|net|io|co)\b/gi, '[link removed]');
}

function stripPhoneNumbers(text: string): string {
  return text.replace(/\+?234\d{10}/g, '[phone removed]')
    .replace(/\b0[789][01]\d{8}\b/g, '[phone removed]')
    .replace(/\b\d{11}\b/g, '[phone removed]');
}

function sanitizeMessage(text: string): string {
  let cleaned = text.trim();
  cleaned = stripUrls(cleaned);
  cleaned = stripPhoneNumbers(cleaned);
  cleaned = cleaned.replace(/<[^>]*>/g, ''); // strip HTML
  return cleaned;
}
```

## Security Rules
1. **ALWAYS** verify user is participant in order before allowing message send
2. **ALWAYS** enforce window-based messaging (check order status)
3. **ALWAYS** sanitize URLs and phone numbers
4. Only show message thread to order participants
5. **NEVER** expose sensitive info (payment details, addresses) in messages
6. Messages cannot be deleted (audit trail)
7. System messages (STATUS_UPDATE) generated server-side only
8. Profanity checks flag for admin review (don't block)
9. Rate limit: 10 messages per user per order
