// Sendchamp integration.
//
//  - OTP / phone verification via Sendchamp's Verification API
//  - Transactional SMS via Sendchamp's SMS Send API

import { request } from 'node:https'

const SENDCHAMP_BASE = (process.env.SENDCHAMP_BASE_URL || 'https://api.sendchamp.com/api/v1').replace(/\/$/, '')
const OTP_TIMEOUT_MS = 25_000
const SMS_TIMEOUT_MS = 20_000

function authHeaders(): Record<string, string> {
  const apiKey = process.env.SENDCHAMP_API_KEY?.trim()
  if (!apiKey) throw new Error('SENDCHAMP_API_KEY is not configured')

  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

interface SendchampHttpResponse<T> {
  status: number
  data: T | null
  text: string
}

/**
 * Sendchamp currently fails during Node 24's built-in fetch/Undici transport,
 * before an HTTP response is returned. The native HTTPS client reaches the
 * same API normally, so keep provider traffic on this small server-only
 * transport until Sendchamp's edge compatibility is fixed.
 */
function postJson<T>(path: string, payload: unknown, timeoutMs: number): Promise<SendchampHttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = request(`${SENDCHAMP_BASE}${path}`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data: T | null = null
        try { data = JSON.parse(text) as T } catch { /* provider returned a non-JSON error */ }
        resolve({ status: res.statusCode ?? 0, data, text })
      })
    })

    req.on('timeout', () => req.destroy(new Error('Sendchamp request timed out')))
    req.on('error', reject)
    req.end(body)
  })
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
    const res = await postJson<VerificationResponse>('/verification/create', {
      channel: 'whatsapp',
      sender: process.env.SENDCHAMP_SENDER?.trim(),
      token_type: 'numeric',
      token_length: '6',
      expiration_time: 10,
      customer_mobile_number: normalizePhone(phone),
    }, OTP_TIMEOUT_MS)

    const data = res.data
    if (res.status < 200 || res.status >= 300) {
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
    const res = await postJson<VerificationResponse>('/verification/confirm', {
      verification_reference: reference,
      verification_code: code,
    }, OTP_TIMEOUT_MS)

    const data = res.data
    if (res.status < 200 || res.status >= 300) {
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
  const res = await postJson<VerificationResponse>('/sms/send', {
    to: [normalizePhone(to)],
    message,
    sender_name: process.env.SENDCHAMP_SENDER?.trim(),
    route: 'dnd',
  }, SMS_TIMEOUT_MS)

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Sendchamp SMS failed (${res.status}): ${res.text.slice(0, 200)}`)
  }
}

export function whatsAppTemplateConfigured(): boolean {
  return !!(process.env.SENDCHAMP_WA_SENDER && process.env.SENDCHAMP_WA_TEMPLATE_CODE)
}

export async function sendWhatsAppTemplate(to: string, message: string): Promise<void> {
  const sender = process.env.SENDCHAMP_WA_SENDER
  const templateCode = process.env.SENDCHAMP_WA_TEMPLATE_CODE
  if (!sender || !templateCode) throw new Error('WhatsApp template not configured')

  const res = await postJson<VerificationResponse>('/whatsapp/message/send', {
    recipient: normalizePhone(to),
    sender,
    type: 'template',
    template_code: templateCode,
    custom_data: { body: { '1': message } },
  }, SMS_TIMEOUT_MS)

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Sendchamp WhatsApp failed (${res.status}): ${res.text.slice(0, 200)}`)
  }
}
