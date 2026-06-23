// Single source of truth for the static security headers applied to EVERY
// response. Imported by next.config.ts (which actually sends them) and by
// lib/security-health.ts (which audits them). Keeping one list means the audit
// can never drift from what the app really sends.
//
// The Content-Security-Policy is NOT here: it needs a per-request nonce and is
// attached in proxy.ts instead.
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // 2 years, subdomains, preload-eligible.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

// Whether a given response header is configured (case-insensitive).
export function isSecurityHeaderConfigured(name: string): boolean {
  return SECURITY_HEADERS.some((h) => h.key.toLowerCase() === name.toLowerCase())
}
