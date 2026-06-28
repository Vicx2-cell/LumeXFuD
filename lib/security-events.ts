import { createSupabaseAdmin } from './supabase/server'

// The app-side writer for the hash-chained security_events spine (migration 085).
// Every defensive layer calls this; the DB trigger computes prev_hash/row_hash.
// It NEVER throws — a detection-layer failure must not break the request path —
// and it REDACTS secrets from `detail` so tokens/PINs/phones never land in the
// log (FORTRESS rule #5).

export type SecuritySeverity = 'info' | 'warn' | 'critical'

export type SecurityEventType =
  | 'auth_fail' | 'authz_deny' | 'ratelimit_hit' | 'webhook_reject'
  | 'stepup_fail' | 'ledger_anomaly' | 'handover_bruteforce' | 'ai_injection'
  | 'session_revoked' | 'rls_coverage_gap' | 'chain_tamper'

export interface SecurityEventInput {
  eventType: SecurityEventType
  severity: SecuritySeverity
  surface: string
  actorId?: string | null
  actorRole?: string | null
  sessionId?: string | null
  ip?: string | null
  userAgent?: string | null
  detail?: Record<string, unknown>
}

// Keys whose VALUE must never be persisted, at any nesting depth.
const REDACT_KEY = /(pin|otp|token|secret|password|passwd|hash|authorization|cookie|bank|account_number|routing|card|cvv|jwt|phone)/i

/** Deep-redact secret-looking keys from an arbitrary detail payload. Pure. */
export function redactDetail(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limited]'
  if (Array.isArray(input)) return input.map((v) => redactDetail(v, depth + 1))
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = REDACT_KEY.test(k) ? '[redacted]' : redactDetail(v, depth + 1)
    }
    return out
  }
  return input
}

export async function recordSecurityEvent(e: SecurityEventInput): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    const { error } = await db.from('security_events').insert({
      actor_id: e.actorId ?? null,
      actor_role: e.actorRole ?? null,
      session_id: e.sessionId ?? null,
      ip: e.ip ?? null,
      user_agent: e.userAgent ? e.userAgent.slice(0, 300) : null,
      event_type: e.eventType,
      severity: e.severity,
      surface: e.surface,
      detail: redactDetail(e.detail ?? {}),
    })
    if (error) console.error('[security-events] insert failed:', error.message)
  } catch (err) {
    // Spine may not exist yet (migration 085 not run) or DB blip — never throw.
    console.error('[security-events] insert threw:', err)
  }
}
