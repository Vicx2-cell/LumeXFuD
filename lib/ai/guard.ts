import { Redis } from '@upstash/redis'
import { rateLimitGeneric, type RateLimitResult } from '@/lib/rate-limit'

// ════════════════════════════════════════════════════════════════════════════
// AI guard rail: PII redaction, per-user rate limits, a global hourly LLM call
// cap, and a circuit breaker. Cost is capped in code, not in hope (AI_SPEC §0.7).
// The pure functions here (redaction, hourBucket) and the store-injectable
// CircuitBreaker are unit-tested in __tests__/guard.test.ts.
// ════════════════════════════════════════════════════════════════════════════

// ─── PII redaction ───────────────────────────────────────────────────────────
// Every payload entering a prompt is scrubbed first (AI_SPEC §7): emails, phone
// numbers, secret keys, tokens. Over-redaction is safe; under-redaction leaks
// student PII into a third-party model. When unsure, redact.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Nigerian numbers: +2348012345678 / 2348012345678 / 08012345678. Guard against
// being inside a longer digit run so we don't chop arbitrary numbers in half.
const NG_PHONE_RE = /(?<!\d)(?:\+?234\d{10}|0\d{10})(?!\d)/g
// E.164-ish international fallback (8+ digits after +).
const INTL_PHONE_RE = /(?<!\d)\+\d{8,15}(?!\d)/g
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const PROVIDER_KEY_RE = /\b[sprt]k_(?:live|test)_[A-Za-z0-9]+/g // Paystack/Stripe-style
const ANTHROPIC_KEY_RE = /\bsk-ant-[A-Za-z0-9_-]+/g
const LONG_HEX_RE = /\b[A-Fa-f0-9]{32,}\b/g // session tokens, HMACs, raw secrets

/**
 * Redact PII and secrets from a free-text string before it enters a prompt or an
 * alert. Pure function — no I/O. Order matters: structured secrets (keys, JWTs,
 * bearer tokens) are removed before the broad phone/hex sweeps so they aren't
 * partially mangled into something that survives.
 */
export function redactPII(input: string): string {
  if (!input) return input
  return input
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(ANTHROPIC_KEY_RE, '[redacted-key]')
    .replace(PROVIDER_KEY_RE, '[redacted-key]')
    .replace(JWT_RE, '[redacted-token]')
    .replace(BEARER_RE, 'Bearer [redacted-token]')
    .replace(NG_PHONE_RE, '[redacted-phone]')
    .replace(INTL_PHONE_RE, '[redacted-phone]')
    .replace(LONG_HEX_RE, '[redacted-secret]')
}

// Keys whose values are never useful to a model and frequently carry secrets —
// dropped wholesale during object redaction regardless of their content.
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'pin',
  'pin_hash',
  'login_pin_hash',
  'secret',
  'apikey',
  'api_key',
  'bank_account',
  'account_number',
  'subaccount',
  'request_body',
  'body',
  'phone',
  'email',
])

/**
 * Deep-redact an arbitrary value for logging/prompting: scrubs strings via
 * redactPII and blanks any property whose key is sensitive. Returns a new
 * structure; the input is not mutated.
 */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted-depth]'
  if (typeof value === 'string') return redactPII(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : redactObject(v, depth + 1)
  }
  return out
}

// ─── Time bucketing ──────────────────────────────────────────────────────────
/** The integer hour bucket for a timestamp — keys the global LLM call counter. Pure. */
export function hourBucket(now: number = Date.now()): number {
  return Math.floor(now / 3_600_000)
}

// ─── Redis-backed key/value store (lazy) ─────────────────────────────────────
export interface GuardStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  incr(key: string, ttlSeconds: number): Promise<number>
}

function getRedisStore(): GuardStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const redis = new Redis({ url, token })
  return {
    async get(key) {
      const v = await redis.get<string>(key)
      return v === undefined || v === null ? null : String(v)
    },
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, { ex: ttlSeconds })
    },
    async incr(key, ttlSeconds) {
      const n = await redis.incr(key)
      if (n === 1) await redis.expire(key, ttlSeconds)
      return n
    },
  }
}

// ─── Global hourly LLM call cap ──────────────────────────────────────────────
const DEFAULT_HOURLY_CAP = Number(process.env.SENTINEL_LLM_HOURLY_CAP) || 200

/**
 * Record one LLM call against the global hourly budget and report whether we are
 * still under the cap. Call this immediately BEFORE every Anthropic request and
 * abort the request when `allowed` is false (AI_SPEC §B2: > cap calls/hour →
 * circuit-break). Fails OPEN when Redis is unconfigured (local dev) so AI still
 * works — the cap is a prod cost guard, not a correctness requirement.
 */
export async function recordLlmCall(
  cap: number = DEFAULT_HOURLY_CAP,
  store: GuardStore | null = getRedisStore()
): Promise<{ allowed: boolean; count: number }> {
  if (!store) return { allowed: true, count: 0 }
  try {
    const count = await store.incr(`ai:llm:calls:${hourBucket()}`, 3700)
    return { allowed: count <= cap, count }
  } catch (err) {
    console.error('[ai/guard] recordLlmCall error — failing open:', err)
    return { allowed: true, count: 0 }
  }
}

// ─── Per-user rate limit ─────────────────────────────────────────────────────
/**
 * Per-user AI rate limit, layered on top of the global cap. Thin wrapper over
 * the project's Upstash limiter (lib/rate-limit.ts). Fails OPEN on a Redis blip
 * like other non-money routes — the global cap is the real cost backstop.
 */
export function aiUserRateLimit(
  userKey: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  return rateLimitGeneric(`ai:user:${userKey}`, max, windowSeconds)
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────
export interface BreakerOptions {
  /** Consecutive-window failures that trip the breaker open. */
  threshold: number
  /** How long the breaker stays open once tripped (seconds). */
  cooldownSeconds: number
  /** Window over which failures are counted (seconds). */
  windowSeconds: number
}

/**
 * A simple Redis-backed circuit breaker. Trips open after `threshold` failures
 * within `windowSeconds`, then refuses calls for `cooldownSeconds`. Store is
 * injectable so the breaker logic is unit-tested against an in-memory map with
 * no Redis dependency. When no store is available it fails OPEN (always passes)
 * — AI degrading silently must never block the underlying user action.
 */
export class CircuitBreaker {
  private readonly store: GuardStore | null

  constructor(
    private readonly name: string,
    private readonly opts: BreakerOptions,
    store?: GuardStore | null
  ) {
    this.store = store === undefined ? getRedisStore() : store
  }

  private failKey(): string {
    return `ai:breaker:${this.name}:fails`
  }
  private openKey(): string {
    return `ai:breaker:${this.name}:open`
  }

  /** True if a call may proceed (breaker closed). */
  async canPass(): Promise<boolean> {
    if (!this.store) return true
    const open = await this.store.get(this.openKey())
    return !open
  }

  /** Record a failure; trips the breaker open once the threshold is reached. */
  async recordFailure(): Promise<void> {
    if (!this.store) return
    const fails = await this.store.incr(this.failKey(), this.opts.windowSeconds)
    if (fails >= this.opts.threshold) {
      await this.store.set(this.openKey(), '1', this.opts.cooldownSeconds)
    }
  }

  /** Record a success; clears the rolling failure count. */
  async recordSuccess(): Promise<void> {
    if (!this.store) return
    await this.store.set(this.failKey(), '0', this.opts.windowSeconds)
  }
}

/** In-memory GuardStore for tests (TTLs are accepted but not enforced). */
export function createMemoryStore(): GuardStore {
  const map = new Map<string, string>()
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null
    },
    async set(key, value) {
      map.set(key, value)
    },
    async incr(key) {
      const next = Number(map.get(key) ?? '0') + 1
      map.set(key, String(next))
      return next
    },
  }
}
