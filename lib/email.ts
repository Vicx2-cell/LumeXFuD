import 'server-only'

import { Resend } from 'resend'
import { z } from 'zod'

const FROM = 'LumeX Fud <hello@lumexfud.com.ng>'
const emailSchema = z.string().trim().email().max(254)

export type EmailSendResult =
  | { status: 'sent'; id: string }
  | { status: 'skipped'; reason: 'invalid_recipient' | 'not_configured' | 'non_production' }
  | { status: 'failed'; code: string }

export interface TransactionalEmail {
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
}

let client: Resend | null = null

function resendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return null
  client ??= new Resend(apiKey)
  return client
}

function deliveryIsEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production'
}

export function normalizeEmail(value: unknown): string | null {
  const parsed = emailSchema.safeParse(value)
  return parsed.success ? parsed.data.toLowerCase() : null
}

/** The only function that talks to Resend. Never throws into a business flow. */
export async function sendTransactionalEmail(message: TransactionalEmail): Promise<EmailSendResult> {
  const to = normalizeEmail(message.to)
  if (!to) return { status: 'skipped', reason: 'invalid_recipient' }
  if (!deliveryIsEnabled()) return { status: 'skipped', reason: 'non_production' }

  const resend = resendClient()
  if (!resend) return { status: 'skipped', reason: 'not_configured' }

  try {
    const { data, error } = await resend.emails.send(
      {
        from: FROM,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      { idempotencyKey: message.idempotencyKey },
    )

    if (error || !data?.id) {
      return { status: 'failed', code: error?.name ?? 'resend_error' }
    }
    return { status: 'sent', id: data.id }
  } catch {
    return { status: 'failed', code: 'transport_error' }
  }
}
