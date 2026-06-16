// ============================================================
// Sentry data scrubbing — runs in client, server AND edge runtimes.
// ============================================================
// Non-negotiable (CLAUDE.md rule #16): never log full phone numbers, bank
// details, or tokens. Sentry events can carry far more than a stack trace —
// request bodies, headers, cookies, breadcrumbs, local-variable snapshots — so
// we treat EVERY outgoing event as untrusted and scrub it before it leaves the
// process. Two layers:
//
//   1. Key-based redaction — any object key whose name looks sensitive (pin,
//      otp, token, phone, card, authorization, cookie, …) has its value blanked
//      regardless of content.
//   2. Value-based redaction — every remaining string is scanned for JWTs,
//      Bearer tokens, Paystack keys, Nigerian phone numbers and card PANs, which
//      are masked even when they appear in a free-text message or stack frame.
//
// Keep this file dependency-free and pure TS (no Node/DOM APIs) so it is safe to
// import from the edge runtime config. (The @sentry/nextjs import below is
// type-only — erased at compile time, zero runtime/edge impact.)
// ============================================================

import type { Event } from '@sentry/nextjs'

const REDACTED = '[redacted]'

// Object keys (case-insensitive substring match) whose values are always wiped.
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'pin',
  'otp',
  'token',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'session',
  'card',
  'cvv',
  'cvc',
  'pan',
  'account_number',
  'accountnumber',
  'bank',
  'phone',
  'msisdn',
  'email',
  'dsn',
  'apikey',
  'api_key',
  'service_role',
  'signature',
  'address',
]

// Value patterns masked anywhere they appear inside a string.
const VALUE_PATTERNS: RegExp[] = [
  // JWT (header.payload.signature)
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Bearer / token auth headers
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  // Paystack secret/public keys
  /\b[ps]k_(?:live|test)_[A-Za-z0-9]+/gi,
  // Nigerian phone numbers in E.164 (+234…) and local (0…) form
  /\+234\d{7,11}/g,
  /\b0\d{10}\b/g,
  // Card PANs: 13–19 digits, optionally space/dash separated
  /\b(?:\d[ -]?){13,19}\b/g,
]

function redactString(input: string): string {
  let out = input
  for (const re of VALUE_PATTERNS) out = out.replace(re, REDACTED)
  return out
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p))
}

// Recursively scrub an arbitrary value. Bounded depth + a seen-set guard against
// cycles and pathological payloads so scrubbing can never hang event delivery.
function scrub(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > 8) return REDACTED
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value as object)) return REDACTED
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrub(val, depth + 1, seen)
  }
  return out
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction` hook. Strips identity + drops
 * request cookies/headers/body outright, then deep-scrubs everything else.
 * Returns the sanitised event (never null — we still want the error, just clean).
 *
 * Generic over Sentry's `Event` so it satisfies both `beforeSend`
 * (`ErrorEvent`) and `beforeSendTransaction` (`TransactionEvent`).
 */
export function scrubEvent<T extends Event>(event: T): T {
  // Drop identity wholesale — we never need to know *who* hit the error to fix it.
  delete event.user

  if (event.request) {
    // These three are the highest-risk carriers (auth cookies, JWT/bearer
    // headers, raw request bodies with PINs/phones/card data) — remove entirely
    // rather than rely on pattern matching.
    delete event.request.cookies
    delete event.request.headers
    delete event.request.data
    delete event.request.query_string
  }

  // Deep-scrub the remainder (message, exception values, breadcrumbs, extra,
  // contexts, remaining request fields like the URL).
  return scrub(event, 0, new WeakSet()) as T
}

/**
 * The Sentry DSN. Server + edge read SENTRY_DSN (server-only env var, the
 * canonical source). The browser bundle can only see NEXT_PUBLIC_* vars, so the
 * client config falls back to NEXT_PUBLIC_SENTRY_DSN. A DSN is a write-only
 * ingestion key (it cannot read project data), so exposing it to the client is
 * safe and standard. Never hardcoded — always read from the environment.
 */
export const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
