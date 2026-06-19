// Sendchamp integration — replaces the previous Termii integration.
//
//  - OTP / phone verification via Sendchamp's Verification API (create + confirm)
//  - Transactional SMS via Sendchamp's SMS Send API (used by lib/notify)
//
// SENDCHAMP_API_KEY is server-only — it is NEVER prefixed with NEXT_PUBLIC_ and
// must not be imported into client components.

const SENDCHAMP_BASE = 'https://api.sendchamp.com/api/v1'

// Sendchamp's verification/create dispatches the SMS and only THEN responds —
// from Vercel's region that round-trip has been observed at ~11s. A short
// timeout aborts AFTER the SMS is already sent, so the user gets the code but
// the app reports failure. Give it real headroom (routes set maxDuration to
// match). See app/api/auth/otp/*.
const OTP_TIMEOUT_MS = 25_000
const SMS_TIMEOUT_MS = 20_000

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.SENDCHAMP_API_KEY ?? ''}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/**
 * Normalize a Nigerian phone number to Sendchamp's `234XXXXXXXXXX` form.
 * Accepts: 08012345678, +2348012345678, 2348012345678, 8012345678.
 *
 * NOTE: the rest of the app stores/looks up users in E.164 (`+234…`) via
 * lib/phone. This helper exists only to shape the number for Sendchamp's API,
 * which wants the leading-`234`, no-`+` form. Callers pass either form; the
 * Sendchamp request functions below normalize again defensively.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('234')) return digits
  if (digits.startsWith('0')) return '234' + digits.slice(1)
  if (digits.length === 10) return '234' + digits // bare 8012345678
  return digits
}

export type OtpSendResult = { ok: true; reference: string } | { ok: false; error: string }
export type OtpConfirmResult = { ok: true } | { ok: false; error: string }

// Minimal shape of the Sendchamp Verification responses we read.
interface VerificationResponse {
  message?: string
  data?: { reference?: string } | null
  reference?: string
}

/**
 * Send a 6-digit numeric OTP over WhatsApp via Sendchamp's Verification API.
 * Returns the verification reference (confirmed later by confirmOtp).
 *
 * WhatsApp is used instead of SMS because it doesn't go through Nigerian MNO
 * sender-ID / DND restrictions — no sender registration needed, and it delivers
 * to DND-active lines (MTN etc.) that plain SMS can't reach.
 */
export async function sendOtp(phone: string): Promise<OtpSendResult> {
  try {
    const res = await fetch(`${SENDCHAMP_BASE}/verification/create`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        channel: 'whatsapp',
        sender: process.env.SENDCHAMP_SENDER,
        token_type: 'numeric',
        token_length: '6',
        expiration_time: 10,
        customer_mobile_number: normalizePhone(phone),
      }),
      signal: AbortSignal.timeout(OTP_TIMEOUT_MS),
    })

    const data = (await res.json().catch(() => null)) as VerificationResponse | null
    if (!res.ok) {
      console.error('[sendchamp] create non-2xx', res.status, data?.message ?? '')
      return { ok: false, error: data?.message ?? `Sendchamp send failed (${res.status})` }
    }
    // Reference comes back at data.data.reference (fallback data.reference).
    const reference = data?.data?.reference ?? data?.reference
    if (!reference) {
      console.error('[sendchamp] create ok but no reference')
      return { ok: false, error: 'Sendchamp returned no verification reference' }
    }
    return { ok: true, reference: String(reference) }
  } catch (err) {
    console.error('[sendchamp] create threw', err instanceof Error ? err.message : err)
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Confirm a code against a previously issued verification reference. */
export async function confirmOtp(reference: string, code: string): Promise<OtpConfirmResult> {
  try {
    const res = await fetch(`${SENDCHAMP_BASE}/verification/confirm`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        verification_reference: reference,
        verification_code: code,
      }),
      signal: AbortSignal.timeout(OTP_TIMEOUT_MS),
    })

    const data = (await res.json().catch(() => null)) as VerificationResponse | null
    if (!res.ok) {
      console.error('[sendchamp] confirm non-2xx', res.status, data?.message ?? '')
      return { ok: false, error: data?.message ?? `Verification failed (${res.status})` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[sendchamp] confirm threw', err instanceof Error ? err.message : err)
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Low-level transactional SMS via Sendchamp. Throws on non-2xx (callers wrap).
 * Used by lib/notify's sendWhatsAppWithFallback for every user-facing alert.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  const res = await fetch(`${SENDCHAMP_BASE}/sms/send`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      to: [normalizePhone(to)],
      message,
      sender_name: process.env.SENDCHAMP_SENDER,
      route: 'dnd',
    }),
    signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sendchamp SMS failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

/** True when a WhatsApp notification template is configured (sender + template code). */
export function whatsAppTemplateConfigured(): boolean {
  return !!(process.env.SENDCHAMP_WA_SENDER && process.env.SENDCHAMP_WA_TEMPLATE_CODE)
}

/**
 * Send a transactional notification over WhatsApp using an approved template.
 *
 * Requires (env):
 *   SENDCHAMP_WA_SENDER        — your activated WhatsApp Business number
 *   SENDCHAMP_WA_TEMPLATE_CODE — a single-variable {{1}} "utility" template code
 *
 * The whole rendered message is passed as body variable "1", so one generic
 * template carries every notification. Throws if unconfigured (callers fall
 * back to SMS) or on a non-2xx response.
 */
export async function sendWhatsAppTemplate(to: string, message: string): Promise<void> {
  const sender = process.env.SENDCHAMP_WA_SENDER
  const templateCode = process.env.SENDCHAMP_WA_TEMPLATE_CODE
  if (!sender || !templateCode) throw new Error('WhatsApp template not configured')

  const res = await fetch(`${SENDCHAMP_BASE}/whatsapp/message/send`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      recipient: normalizePhone(to),
      sender,
      type: 'template',
      template_code: templateCode,
      custom_data: { body: { '1': message } },
    }),
    signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sendchamp WhatsApp failed (${res.status}): ${text.slice(0, 200)}`)
  }
}
