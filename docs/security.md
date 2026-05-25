# Security Hardening + Penetration Testing

## Critical Version Requirements

### Next.js Version (NON-NEGOTIABLE)
- **Minimum**: `15.5.18` OR `16.2.6` (May 2026 patches 13 CVEs)
- **Verify before EVERY deploy**:
  ```bash
  npx next --version
  ```
- **CVEs patched** (May 2026):
  - `CVE-2026-44575`: `.rsc/segment-prefetch` middleware bypass
  - `CVE-2026-44574`: query parameter injection bypass
  - `CVE-2026-44573`: i18n locale bypass
  - `CVE-2026-44578`: WebSocket SSRF in self-hosted apps
  - `CVE-2026-23870`: RSC DoS attacks
- **Note**: WAF rules do NOT mitigate these. Patching is the **ONLY** fix.

## Security Headers (`next.config.ts`)

```typescript
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https://*.supabase.co",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://api.paystack.co",
      "frame-src 'self' https://checkout.paystack.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  },
];
```

## CSRF Protection
All `POST`/`PATCH`/`DELETE` routes must verify origin and use double-submit cookie pattern.

### `lib/csrf.ts`
```typescript
export function verifyCSRF(req: Request): boolean {
  const origin = req.headers.get('origin');
  const allowed = [process.env.NEXT_PUBLIC_APP_URL!];

  if (!origin || !allowed.includes(origin)) {
    return false;
  }

  // Double-submit cookie pattern
  const csrfCookie = req.headers.get('cookie')?.match(/csrf-token=([^;]+)/)?.[1];
  const csrfHeader = req.headers.get('x-csrf-token');

  if (!csrfCookie || !csrfHeader) return false;
  return crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader));
}
```

**All cookies set with**:
- `httpOnly: true` (prevents XSS from accessing cookie)
- `secure: true` (production only, ensures HTTPS)
- `sameSite: 'strict'` (prevents CSRF; or 'lax' for auth flows)

## SSRF Protection
AI-generated code often introduces SSRF. LumeX implements strict private IP blocking and domain whitelisting.

### Blocking Private IPs (`lib/security.ts`)
```typescript
const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./, // AWS metadata & link-local
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export function isPrivateIP(host: string): boolean {
  return PRIVATE_IP_RANGES.some(rx => rx.test(host));
}

export async function safeFetch(url: string): Promise<Response> {
  const parsed = new URL(url);

  // Only HTTPS in production
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS allowed');
  }

  // Block localhost
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    throw new Error('Localhost not allowed');
  }

  // Resolve and check IP
  const ip = await resolveDNS(parsed.hostname); // resolveDNS is a placeholder for actual DNS lookup
  if (isPrivateIP(ip)) {
    throw new Error('Private IPs not allowed');
  }

  return fetch(url);
}
```

### Whitelisting External Domains
- Paystack callbacks: only `https://api.paystack.co`
- Images: only `https://*.supabase.co`
- Webhook origin: validate against Paystack's official IP list (dynamic)

## Supabase RLS Audit
The most common AI failure: `USING (true)` policies that look like security but allow everything.

### Required Audit Before Deploy
```sql
-- Find tables WITHOUT RLS enabled
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
-- Expected: ZERO rows

-- Find permissive policies (fake security)
SELECT tablename, policyname, qual, with_check
FROM pg_policies
WHERE qual = 'true' OR with_check = 'true';
-- Expected: ZERO rows (unless explicitly documented as public data)

-- Find tables WITH RLS enabled but NO policies (locks out everyone — also wrong)
SELECT t.tablename
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename
WHERE t.schemaname = 'public' AND t.rowsecurity = true AND p.policyname IS NULL;
-- Expected: ZERO rows
```

### Example Correct RLS Policies
```sql
-- Customers see only their own orders
CREATE POLICY "customers see own orders" ON orders
  FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE phone = auth.jwt() ->> 'phone'
    )
  );

-- Vendors see only their own orders
CREATE POLICY "vendors see own orders" ON orders
  FOR SELECT USING (
    vendor_id IN (
      SELECT id FROM vendors WHERE phone = auth.jwt() ->> 'phone'
    )
  );

-- Riders see orders assigned to them OR available (READY status)
CREATE POLICY "riders see assigned or available" ON orders
  FOR SELECT USING (
    rider_id IN (SELECT id FROM riders WHERE phone = auth.jwt() ->> 'phone')
    OR (status = 'READY' AND rider_id IS NULL)
  );

-- NEVER use USING (true) — that's fake security
```

## Service Role Key Audit
The catastrophic mistake: leaking `SUPABASE_SERVICE_ROLE_KEY` to client code. Before every deploy, run these greps. If any return matches in client code, **STOP** deployment.

```bash
# Service role key in components (CATASTROPHIC if found)
grep -r "SUPABASE_SERVICE_ROLE_KEY" app/ components/

# NEXT_PUBLIC_ prefix on service key (would expose it)
grep -r "NEXT_PUBLIC_.*SERVICE" .

# service_role in client-accessible files
grep -r "service_role" app/

# Check production build for accidental exposure (matches JWT prefix)
grep -r "eyJhbGciOiJIUzI1" .next/static/
```

**Service role key allowed locations**:
- `.env.local` (gitignored)
- `lib/supabase/server.ts` (server-only)
- API routes (`app/api/**/route.ts`)
- Cron handlers
- Server actions (`'use server'` files)

## Storage Bucket Security

```sql
-- Required bucket configuration\nINSERT INTO storage.buckets (id, name, public) VALUES\n  ('menu-images', 'menu-images', false), -- private, use signed URLs\n  ('delivery-proofs', 'delivery-proofs', false), -- private, admin only\n  ('processed-images', 'processed-images', true); -- public, only resized output\n\n-- Policies (examples)\nCREATE POLICY "vendors upload own menu images" ON storage.objects\n  FOR INSERT WITH CHECK (\n    bucket_id = 'menu-images'\n    AND (storage.foldername(name))[1] = auth.jwt() ->> 'vendor_id'\n  );\n\nCREATE POLICY "service role only delivery proofs" ON storage.objects\n  FOR ALL USING (\n    bucket_id = 'delivery-proofs'\n    AND auth.jwt() ->> 'role' IN ('admin', 'super_admin', 'rider')\n  );\n```\n\n## Image Upload Security\nStrict validation and processing for all user-uploaded images.\n\n```typescript\nimport sharp from 'sharp';\nimport { fileTypeFromBuffer } from 'file-type';\n\nconst ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];\nconst MAX_SIZE = 5 * 1024 * 1024; // 5MB\n\nasync function processImageUpload(file: File): Promise<Buffer> {\n  // 1. Size check\n  if (file.size > MAX_SIZE) throw new Error('File too large');\n\n  // 2. Read into buffer\n  const buffer = Buffer.from(await file.arrayBuffer());\n\n  // 3. MAGIC BYTES check (NOT file extension — that lies)\n  const detected = await fileTypeFromBuffer(buffer);\n  if (!detected || !ALLOWED_TYPES.includes(detected.mime)) {\n    throw new Error('Invalid file type');\n  }\n\n  // 4. Strip EXIF, resize, convert to webp\n  const processed = await sharp(buffer)\n    .rotate() // honor EXIF orientation, then strip\n    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })\n    .webp({ quality: 80 })\n    .toBuffer();\n\n  return processed;\n}\n```\n\n## Supply Chain Security\n- **Pin all dependencies** (no `^` or `~`). Example: `"next": "15.5.18"`
- Use `npm ci` (not `npm install`) in production deployments
- **Audit**: `npm audit --audit-level=high` before every deploy
- **Verify `package-lock.json`** is committed to git

## Hallucinated Package Check\nAI sometimes suggests packages that don't exist or have incorrect names. **Verify each on npmjs.com** before installation:\n- `@supabase/ssr` ✅ (NOT `@supabase-ssr`)\n- `@upstash/ratelimit` ✅ (NOT `@upstash/rate-limit`)\n- `libphonenumber-js` ✅ (NOT `libphonenumber`)\n- `@sentry/nextjs` ✅\n- `sharp` ✅\n- `zod` ✅\n
## Cookie Consent (NDPR Compliant)\nBanner on first visit, with essential vs analytics cookie choices.\n
```html\n<div className="fixed bottom-0 inset-x-0 p-4 bg-zinc-900 border-t border-zinc-800 z-50">\n  <p className="text-sm">\n    We use cookies to keep you logged in and improve your experience.\n    Read our <a href="/privacy">privacy policy</a>.\n  </p>\n  <div className="flex gap-2 mt-2">\n    <button onClick={acceptAll}>Accept</button>\n    <button onClick={essentialOnly}>Essential Only</button>\n  </div>\n</div>\n```\n\n- Consent stored in `consent` cookie with 1-year expiry.
- **Essential cookies** (auth, sessions): always allowed.
- **Analytics cookies** (Sentry): require explicit accept.

## Penetration Test Checklist\nAfter all features built, systematically attempt to break your own code. Document each test: what tested, expected, actual, PASS/FAIL.\n\n### CVE-2026-44575 Test (CRITICAL Next.js Bypass)\n- [ ] Try accessing `/admin.rsc` directly → must redirect or 403\n- [ ] Try accessing `/vendor-dashboard.rsc` → must redirect or 403\n- [ ] Try accessing `/_next/data/[buildId]/admin.json` → must redirect or 403\n- [ ] Try accessing `/super-admin.rsc` → must redirect or 403\n- [ ] Verify Next.js version is `15.5.18+` or `16.2.6+`\n\n### Authentication Attacks\n- [ ] OTP brute force: try 6 OTPs rapidly → lock after 5 attempts\n- [ ] OTP replay: use same OTP twice → reject second use\n- [ ] Phone normalization: `08012345678` vs `+2348012345678` → same account\n- [ ] Session fixation: use old token after logout → reject\n- [ ] Role escalation: customer JWT on `/admin` route → redirect or 403\n- [ ] `x-middleware-subrequest` header → does NOT bypass auth\n\n### Payment Attacks\n- [ ] Price manipulation: send `total_amount: 100` for ₦2000 order → server recalculates\n- [ ] Webhook replay: send same Paystack webhook twice → second ignored (idempotency)\n- [ ] Webhook forgery: send webhook with wrong HMAC signature → 400 + log\n- [ ] Free order: modify cart in devtools → server recalculates correctly (server-side pricing)\n- [ ] Refund manipulation: customer tries to trigger refund → 403\n
### Authorization (BOLA) Attacks\n- [ ] Customer A views Customer B's order → 403\n- [ ] Vendor A accepts Vendor B's order → 403\n- [ ] Rider tries admin routes → redirect or 403\n- [ ] Customer marks own order as DELIVERED → 403 (status transition control)\n- [ ] Customer views another customer's messages → 403 (message ownership)\n\n### Input Attacks (XSS, SQLi, File Upload, Injections)\n- [ ] XSS: `<script>alert(1)</script>` as address → sanitized/escaped (React auto-escapes, Zod validates)\n- [ ] SQL injection: `'; DROP TABLE orders; --` in input fields → Zod blocks\n- [ ] File upload bypass: `.exe` renamed to `.jpg` → magic bytes reject\n- [ ] Oversized file: 10MB image → reject above 5MB\n- [ ] Link injection in messages → stripped (sanitization function)\n- [ ] Phone number injection in messages → stripped (sanitization function)\n\n### CSRF Tests\n- [ ] `POST` to `/api/orders` from external origin → reject (CORS + CSRF token)\n- [ ] Form submission without `X-CSRF-Token` header → reject\n- [ ] All cookies have `SameSite=strict` or `SameSite=lax`\n\n### SSRF Tests\n- [ ] Image upload URL pointing to `169.254.169.254` (AWS metadata) → reject\n- [ ] Paystack webhook from non-Paystack IP → reject (IP whitelisting/validation)\n- [ ] User input `http://localhost` or `http://127.0.0.1` → reject (private IP blocking)\n
### Race Conditions\n- [ ] Two riders accept same order simultaneously → only one succeeds (`SELECT FOR UPDATE`)\n- [ ] Double-click checkout → one order (idempotency, server-side processing)\n- [ ] Double payment webhook → second ignored (idempotency table)\n- [ ] Two simultaneous withdrawals → only one processes (`SELECT FOR UPDATE`)\n\n### Enumeration Attacks\n- [ ] Sequential order IDs: `LXF-2026-000001`, `000002` → ownership check blocks\n- [ ] Phone enumeration: authentication responses are generic (same for existing/non-existing phone)\n- [ ] Vendor enumeration: anonymous queries respect RLS (only active, open vendors visible)\n\n### Supabase RLS Audit\n- [ ] No tables with `rowsecurity = false`\n- [ ] No policies with `USING (true)` (unless explicitly public and documented)\n- [ ] `SELECT *` from every table with `anon` key → respects RLS (returns filtered/empty)\n\n### Service Role Key Audit\n- [ ] `grep` returns nothing for `SUPABASE_SERVICE_ROLE_KEY` in `app/ components/`\n- [ ] Production build contains no service role key\n- [ ] Sentry logs contain no keys\n
### Storage Security\n- [ ] Anon key cannot enumerate `menu-images` bucket (private)\n- [ ] Non-admin cannot access `delivery-proofs` (private)\n- [ ] No accidentally-public buckets (explicit `public: true` only)\n
  - NEVER use ignoreBuildErrors: true in next.config.ts
  - CSP headers in middleware (block inline scripts, unsafe-eval)
  - Security headers: X-Frame-Options, X-Content-Type-Options

### 6. Vulnerable Components
- **Problem**: Outdated dependencies with CVEs
- **Mitigation**:
  - npm audit before every deploy
  - Fix critical + high severity issues
  - Next.js 15.5.18+ or 16.2.2+ (May 2026 patches 13 CVEs)
  - Regular dependency updates (Dependabot)

### 7. Authentication Failures
- **Problem**: Weak authentication, session hijacking
- **Mitigation**:
  - OTP valid for 10 minutes max
  - OTP limited to 5 attempts before 1-hour lockout
  - New device login → WhatsApp alert with device fingerprint
  - JWT in httpOnly, Secure, SameSite=Strict cookie
  - Session timeout: 30 days for inactive users
  - Admin re-auth required for actions > ₦50,000

### 8. Data Integrity Failures
- **Problem**: Data tampering, business logic bugs
- **Mitigation**:
  - Server-side price calculation (NEVER trust client)
  - Store prices in database only (never localStorage)
  - HMAC verification for Paystack webhooks
  - Idempotency check for webhook processing
  - Audit logs for all admin/super admin actions
  - Daily wallet reconciliation (total wallets = Paystack balance)

### 9. Logging & Monitoring Failures
- **Problem**: Attacks not detected
- **Mitigation**:
  - Log failed auth attempts (otp_attempts table)
  - Log all admin actions (audit_logs)
  - Log all super admin actions (super_audit_logs)
  - NEVER log full phone numbers, bank details, tokens
  - Sentry for error tracking (with PII filter)
  - Alert admin on reconciliation mismatch

### 10. SSRF (Server-Side Request Forgery)
- **Problem**: Server makes requests to internal services
- **Mitigation**:
  - Validate all external URLs
  - Use allowlist for external API calls
  - Timeout on external requests (10 seconds max)
  - Don't proxy user-supplied URLs

## API Security

### Rate Limiting
```
OTP routes (Upstash):
- POST /api/auth/send-otp: 5 requests per hour per phone
- POST /api/auth/verify-otp: 5 attempts per OTP before lockout

Order routes:
- POST /api/orders: 20 orders per hour per customer

General:
- 1000 requests per hour per IP
- 100 requests per minute per user
```

### Input Validation
- ALL POST/PATCH bodies validated with Zod
- Schema defined in lib/validators.ts
- Example:
  ```typescript
  const createOrderSchema = z.object({
    vendor_id: z.string().uuid(),
    items: z.array(z.object({
      menu_item_id: z.string().uuid(),
      quantity: z.number().int().positive()
    })),
    delivery_type: z.enum(['BIKE', 'DOOR'])
  });
  ```

### Error Handling
- Generic error messages to clients
- Detailed errors in logs only
- No stack traces in responses
- No database error messages exposed

## HTTPS & TLS
- Vercel enforces HTTPS only
- Redirect all HTTP to HTTPS
- HSTS header: max-age=31536000

## CORS
- Whitelist NEXT_PUBLIC_APP_URL only
- No wildcard origins
- Credentials: include for same-origin only

## CSP Headers
```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' 'nonce-{random}';
  style-src 'self' 'unsafe-inline';
  img-src 'self' https:;
  font-src 'self';
  connect-src 'self' https://api.paystack.co https://termii.com;
  frame-ancestors 'none';
```

## Database Security

### Row-Level Security (RLS)
- ENABLED on every table
- NEVER use USING (true) — fake security
- Policies verify user_id or role
- Example:
  ```sql
  CREATE POLICY orders_select_customers ON orders
  FOR SELECT USING (auth.uid() = customer_id OR (SELECT role FROM admins WHERE id = auth.uid()) = 'admin');
  ```

### Foreign Key Constraints
- Every foreign key properly indexed
- ON DELETE RESTRICT (prevent orphaned records)
- ON UPDATE CASCADE (propagate updates)

## File Upload Security

### Magic Byte Validation
- Verify file signature (not just extension)
- JPEG: FF D8 FF
- PNG: 89 50 4E 47
- Reject anything else

### Server-Side Resizing
- Use sharp to resize images
- Menu images: max 1200x800 (10KB ~)
- Delivery photos: max 1200x800 (5KB)
- Strip EXIF data (privacy)

### Storage
- Store in Supabase Storage with public read, authenticated write
- Path structure: `ratings/{order_id}/{timestamp}.jpg`
- Set CORS on storage bucket

## Penetration Testing Checklist

### Authentication
- [ ] Test OTP brute force (should lock after 5 attempts)
- [ ] Test OTP expiration (should fail after 10 mins)
- [ ] Test expired JWT (should return 401)
- [ ] Test modified JWT (should return 401)
- [ ] Test stolen session cookie (verify SameSite=Strict blocks)
- [ ] Test new device login (should trigger WhatsApp alert)

### BOLA Vulnerabilities
- [ ] Fetch other customer's order (should return 403)
- [ ] Fetch other vendor's dashboard (should return 403)
- [ ] Fetch other rider's earnings (should return 403)
- [ ] Modify other customer's cart (should return 403)

### Payment Security
- [ ] Test webhook with invalid HMAC (should return 403)
- [ ] Test webhook replay (idempotency check should prevent re-processing)
- [ ] Test negative order amounts (should return 400)
- [ ] Test order total manipulation (should recalculate server-side)

### Data Exposure
- [ ] Check API responses for sensitive data (bank accounts, tokens, full phone)
- [ ] Check localStorage for prices (should be empty)
- [ ] Check request headers for sensitive info (should be clean)
- [ ] Test CORS with unauthorized origin (should be blocked)

### Input Validation
- [ ] SQL injection in search (should be escaped)
- [ ] XSS in order messages (should be HTML-escaped)
- [ ] Large payload attack (should have size limits)
- [ ] Negative quantities in cart (should reject)

### Rate Limiting
- [ ] Hammer OTP endpoint (should be rate-limited)
- [ ] Hammer order creation (should be rate-limited)
- [ ] Hammer login attempts (should be rate-limited)

### Admin Controls
- [ ] Try accessing admin routes as customer (should return 403)
- [ ] Try accessing super admin routes as admin (should return 403)
- [ ] Test re-auth for actions > ₦50,000 (should require new OTP)

## Database Tables for Security

### Audit Logs
- `audit_logs` - All admin actions with timestamps
- `super_audit_logs` - All super admin actions
- `otp_attempts` - Failed OTP attempts for lockout
- `admin_devices` - Device fingerprints for new device alerts

## Deployment Security

### Pre-Deploy Checklist
- [ ] npm audit (zero critical/high)
- [ ] NEVER commit .env.local
- [ ] NEVER commit private keys
- [ ] All environment variables set in Vercel
- [ ] HTTPS enforced
- [ ] CSP headers configured
- [ ] Rate limiting tested
- [ ] BOLA tests passed
- [ ] Payment HMAC verified
- [ ] Database backups configured

### Sentry Configuration
- PII filter enabled (mask phone, email)
- Breadcrumbs for request tracking
- Error alerting to admin WhatsApp
- Release tracking for version management
