import crypto from 'crypto'
import { createSupabaseAdmin } from './supabase/server'

// ─── Shared handover-code engine (pickup AND delivery) ───────────────────────
// Invariant I3 (code secrecy): a handover code exists in exactly two places — the
// customer's app (display) and the server (HASHED). It never appears in SMS,
// WhatsApp, push, logs, Sentry, or any API response to a non-owner.
// Invariant I2/I5: entering the correct code by the assigned, authenticated
// fulfiller is the only thing that releases funds; the code alone moves nothing.
//
// The raw code is returned ONLY by issuance helpers (to be shown to the order's
// owner). Everything persisted is the SHA-256 hash. Verification is constant-time.

// Crockford Base32 minus the ambiguous glyphs the spec calls out (0 O 1 I L U).
// 30 unambiguous characters → 30^6 ≈ 7.3e8 combinations per code.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 6

/** Cryptographically-random 6-char code from the unambiguous alphabet. */
export function generateHandoverCode(): string {
  const n = ALPHABET.length
  // Rejection sampling: a byte (0–255) maps to a char only when it falls inside
  // the largest multiple of `n`, so every character is equally likely (no modulo
  // bias). NEVER Math.random().
  const max = Math.floor(256 / n) * n
  let out = ''
  while (out.length < CODE_LENGTH) {
    const buf = crypto.randomBytes(CODE_LENGTH * 2)
    for (let i = 0; i < buf.length && out.length < CODE_LENGTH; i++) {
      if (buf[i] < max) out += ALPHABET[buf[i] % n]
    }
  }
  return out
}

/**
 * Normalize a typed code for comparison/display: uppercase, strip spaces/dashes.
 * Customers only ever see characters from the safe alphabet, so we don't remap
 * "look-alike" glyphs — we simply reject anything outside it on verify.
 */
export function normalizeHandoverCode(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[\s-]/g, '')
}

/** Shape a code matches before we even hash it (cheap reject of junk). */
export function isWellFormedCode(raw: string): boolean {
  const c = normalizeHandoverCode(raw)
  if (c.length !== CODE_LENGTH) return false
  for (const ch of c) if (!ALPHABET.includes(ch)) return false
  return true
}

/** SHA-256 hex of a normalized code. The only form ever persisted. */
export function hashHandoverCode(raw: string): string {
  return crypto.createHash('sha256').update(normalizeHandoverCode(raw)).digest('hex')
}

/**
 * Constant-time check of a typed code against a stored hash. Returns false for a
 * malformed code or a missing hash WITHOUT a short-circuit that would leak timing
 * about which check failed.
 */
export function verifyHandoverCode(raw: string, storedHash: string | null): boolean {
  if (!storedHash) return false
  if (!isWellFormedCode(raw)) return false
  const candidate = Buffer.from(hashHandoverCode(raw), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (candidate.length !== stored.length) return false
  return crypto.timingSafeEqual(candidate, stored)
}

/**
 * Issue (or rotate) the handover code for an order: generate a fresh code, store
 * ONLY its hash, reset the attempt counter + lock, and return the RAW code so the
 * caller can show it to the order's owner. Any previous code dies instantly (its
 * hash is overwritten).
 *
 * IDEMPOTENT BY DEFAULT (`rotate:false`): if a code already exists for the order,
 * this does NOT generate a new one — it returns `{ code:null, alreadyActive:true }`
 * so the caller leaves the live code untouched. This is the page-mount path: a
 * customer reopening the order (or opening it on a second device) must NOT silently
 * rotate the code, or the code another device is already showing — and that the
 * rider/vendor is about to type — would stop matching. The raw code is unrecoverable
 * once issued (we keep only the hash), so re-display relies on the device's own copy.
 *
 * `rotate:true` (the explicit "Refresh code" action) always mints a fresh code and
 * invalidates the old one — the customer chose to replace it.
 *
 * Returns `{ code:null, alreadyActive:false }` if the row could not be updated
 * (e.g. order gone) — callers must treat that as "no code issued".
 */
export async function issueHandoverCode(
  db: ReturnType<typeof createSupabaseAdmin>,
  orderId: string,
  opts: { rotate?: boolean } = {},
): Promise<{ code: string | null; alreadyActive: boolean }> {
  // Idempotent path: don't touch an existing code unless an explicit rotate was asked.
  if (!opts.rotate) {
    const { data: existing } = await db
      .from('orders')
      .select('handover_code_hash')
      .eq('id', orderId)
      .single()
    if (existing && existing.handover_code_hash) {
      return { code: null, alreadyActive: true }
    }
  }

  const raw = generateHandoverCode()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('orders')
    .update({
      handover_code_hash:     hashHandoverCode(raw),
      handover_code_set_at:   now,
      handover_code_attempts: 0,
      handover_code_locked:   false,
      updated_at:             now,
    })
    .eq('id', orderId)
    .select('id')
  if (error || !data || data.length === 0) return { code: null, alreadyActive: false }
  return { code: raw, alreadyActive: false }
}

/**
 * Record a wrong attempt atomically (DB backstop to the Upstash limiter) and tell
 * the caller whether the order is now locked. Lock → the fulfiller must ask the
 * customer to refresh the code. Never throws; a failure reports "not locked" so a
 * transient DB blip can't permanently jam a legitimate handover.
 */
export async function recordWrongHandoverAttempt(
  db: ReturnType<typeof createSupabaseAdmin>,
  orderId: string,
  limit = 5,
): Promise<{ attempts: number; locked: boolean }> {
  try {
    const { data, error } = await db.rpc('bump_handover_attempts', { p_order_id: orderId, p_limit: limit })
    if (error || !data) return { attempts: 0, locked: false }
    const row = Array.isArray(data) ? data[0] : data
    return { attempts: Number(row?.attempts) || 0, locked: Boolean(row?.locked) }
  } catch {
    return { attempts: 0, locked: false }
  }
}

export const HANDOVER_CODE_LENGTH = CODE_LENGTH
export const HANDOVER_ATTEMPT_LIMIT = 5
