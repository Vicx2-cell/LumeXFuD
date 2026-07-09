// Sendchamp integration.
//
//  - OTP / phone verification via Sendchamp's Verification API
//  - Transactional SMS via Sendchamp's SMS Send API

const SENDCHAMP_BASE = 'https://api.sendchamp.com/api/v1'
const OTP_TIMEOUT_MS = 25_000
const SMS_TIMEOUT_MS = 20_000

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.SENDCHAMP_API_KEY ?? ''}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('234')) return digits
  if (digits.startsWith('0')) return '234' + digits.slice(1)
  if (digits.length === 10) return '234' + digits
  return digits
}

export type OtpSendResult = { ok: true; reference: string } | { ok: false; error: string }
export type OtpConfirmResult = { ok: true } | { ok: false; error: string }

interface VerificationResponse {
  message?: string
  data?: { reference?: string } | null
  reference?: string
}

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
    const text = await res.text().catch(() => '')
    throw new Error(`Sendchamp SMS failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

export function whatsAppTemplateConfigured(): boolean {
  return !!(process.env.SENDCHAMP_WA_SENDER && process.env.SENDCHAMP_WA_TEMPLATE_CODE)
}

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
    const text = await res.text().catch(() => '')
    throw new Error(`Sendchamp WhatsApp failed (${res.status}): ${text.slice(0, 200)}`)
  }
}
