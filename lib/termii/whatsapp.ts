interface WhatsAppParams {
  to: string
  message: string
}

interface TermiiResponse {
  message_id?: string
  message?: string
}

export async function sendWhatsApp({ to, message }: WhatsAppParams): Promise<TermiiResponse> {
  const res = await fetch(process.env.TERMII_WHATSAPP_URL ?? 'https://api.ng.termii.com/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: process.env.TERMII_SENDER_ID,
      sms: message,
      type: 'plain',
      api_key: process.env.TERMII_API_KEY,
      channel: 'whatsapp',
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Termii WhatsApp failed (${res.status}): ${text.slice(0, 200)}`)
  }

  return res.json() as Promise<TermiiResponse>
}

/**
 * Send WhatsApp, fall back to SMS on failure.
 * Use this for all user-facing notifications.
 *
 * Honors the super-admin "Pause notifications" control — when paused, this
 * no-ops (so a cost spike or misfire can be stopped platform-wide in one tap).
 * Every user-facing notification routes through here, so this is the one gate.
 */
export async function sendWhatsAppWithFallback(params: WhatsAppParams): Promise<void> {
  try {
    const { isNotificationsPaused } = await import('../controls')
    if (await isNotificationsPaused()) return
  } catch {
    // controls unreadable — fail open and still send.
  }
  try {
    await sendWhatsApp(params)
  } catch {
    const { sendSMS } = await import('./sms')
    await sendSMS(params)
  }
}
