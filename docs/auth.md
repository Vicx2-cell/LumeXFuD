# Authentication System

## Overview
Custom phone OTP via Termii + JWT in httpOnly cookie. Account required for checkout (frictionless browsing).

## Decision: Account Required (Frictionless)
Customers must verify phone before checkout. Browsing and cart are public.

## Customer Flow
1. Browse homepage → no login required
2. Add items to cart → no login required
3. Tap checkout → login prompt appears
4. Login screen:
   - Phone number input (+234 auto-prefix)
   - "Send OTP" amber button
   - Below in small grey text: "Continue as Guest"
5. OTP screen: 6 individual digit boxes + "Verify" + countdown "Resend in 45s"
6. First time user: name verification (single field, skippable)
7. Returning user: checkout with saved address pre-filled

## Guest Checkout
- Captures: name + phone + delivery address only
- No account saved
- No order history
- No reorder button
- No gamification (no streaks/badges/XP)
- Still gets WhatsApp delivery updates
- Still pays via Paystack

## Session Rules
- JWT in httpOnly cookie ONLY — never localStorage
- Customer session: 24 hours
- Vendor session: 8 hours
- Rider session: 12 hours
- Admin session: 4 hours
- Super Admin session: 2 hours
- OTP expires: 10 minutes
- Max OTP verify attempts: 5 per phone per 15 mins (Upstash rate limit)
- Max OTP sends: 3 per phone per hour (prevents SMS bombing)

## Route Protection
| Route | Access |
|-------|--------|
| / (homepage) | PUBLIC |
| /vendor/[id] | PUBLIC |
| /cart | PUBLIC |
| /checkout | REQUIRES phone verification |
| /order/[id] | Requires order ownership (phone match) |
| /orders | REQUIRES login |
| /profile | REQUIRES login |
| /leaderboard | PUBLIC (read-only) |
| /vendor-dashboard/* | REQUIRES vendor role |
| /rider/* | REQUIRES rider role |
| /admin/* | REQUIRES admin role (ADMIN_PHONE match) |
| /super-admin/* | REQUIRES super admin role (SUPER_ADMIN_PHONE match) |

## Role Detection
1. Get phone from JWT cookie
2. Check vendors table → if found, role = vendor
3. Check riders table → if found, role = rider
4. Check phone matches SUPER_ADMIN_PHONE → role = super_admin
5. Check phone matches ADMIN_PHONE → role = admin
6. Else → role = customer

## API Routes

### POST /api/auth/send-otp
```json
Body: { phone: string }
```

```
1. Normalize phone to E.164 via libphonenumber-js
2. Reject if invalid Nigerian number
3. Rate limit check: 3 sends per phone per hour (Upstash)
4. Generate 6-digit OTP
5. Hash and store in otp_attempts table with expires_at = now + 10 mins
6. Send via Termii SMS
7. Return { success: true, expires_in: 600 }
8. Never reveal whether phone is existing or new (enumeration prevention)
```

### POST /api/auth/verify-otp
```json
Body: { phone: string, otp: string }
```

```
1. Normalize phone
2. Rate limit: 5 attempts per phone per 15 mins (Upstash)
3. Look up otp_attempts WHERE phone AND not used AND expires_at > now
4. If none found → 400 "Invalid or expired OTP"
5. Constant-time string comparison (never use ===)
6. Mark OTP as used (one-time use)
7. Determine role (see Role Detection above)
8. Create session in sessions table (id, user_id, role, expires_at, ip, ua)
9. Sign JWT with session ID + role
10. Set httpOnly cookie: secure, sameSite='strict', maxAge=role-based
11. Return { role, redirect_path }
```

### POST /api/auth/logout
```
1. Get session ID from JWT
2. Delete from sessions table
3. Clear cookie
4. Return 204
```

### GET /api/auth/me
```
1. Verify JWT from cookie
2. Look up session in sessions table (verify not revoked)
3. Look up user details (name, phone, role)
4. Return { id, phone, role, name }
```

### DELETE /api/auth/account (GDPR)
```
1. Verify auth
2. Check no active orders (status NOT IN COMPLETED, CANCELLED, REFUNDED)
3. If active orders → 409 "Cannot delete account with active orders"
4. Soft delete: set users.deleted_at = NOW(), anonymize personal fields
5. Send confirmation WhatsApp
6. Clear session
7. Audit log
```

### GET /api/auth/export (GDPR)
```
1. Verify auth
2. Compile JSON of: user record, all orders, all messages, all ratings, wallet history
3. Return as downloadable JSON file
4. Audit log
```

## Middleware Pattern (Next.js 15+)

```typescript
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // CRITICAL: Use setAll pattern for @supabase/ssr v0.6.0+
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set({ name, value, ...options })
            res.cookies.set({ name, value, ...options })
          })
        },
      },
    }
  )

  // Check JWT, get role, redirect based on path
  // ...

  // Security headers
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')

  return res
}

// CRITICAL: explicit matcher (CVE-2026-44575 awareness)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/paystack/webhook).*)'],
}
```

## Common Failure Patterns (DO NOT MAKE THESE MISTAKES)
1. **NEVER** store JWT in localStorage. Always httpOnly cookie.
2. **NEVER** reveal "phone exists" vs "phone does not exist" in /api/auth/send-otp — always say "OTP sent" regardless.
3. **NEVER** use === for OTP comparison — use constant-time compare.
4. **NEVER** skip rate limiting on send-otp — SMS bombing attack.
5. **NEVER** trust client-provided role — always look it up server-side.
6. **NEVER** skip params await in Next.js 15: `const { id } = await params`
7. **NEVER** skip cookies() await: `const cookieStore = await cookies()`
8. **NEVER** use the old @supabase/ssr cookie pattern (set/remove separately) — use setAll.

## Database Schema

### otp_attempts
```sql
CREATE TABLE otp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_otp_attempts_phone ON otp_attempts(phone, expires_at) WHERE used_at IS NULL;
```

### sessions
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','vendor','rider','admin','super_admin')),
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address INET,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
```