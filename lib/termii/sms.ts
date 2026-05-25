interface SmsParams {
  to: string
  message: string
}

interface TermiiResponse {
  message_id?: string
  message?: string
  balance?: number
  user?: string
}

export async function sendSMS({ to, message }: SmsParams): Promise<TermiiResponse> {
  const res = await fetch(process.env.TERMII_SMS_URL ?? 'https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: process.env.TERMII_SENDER_ID,
      sms: message,
      type: 'plain',
      api_key: process.env.TERMII_API_KEY,
      channel: 'generic',
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Termii SMS failed (${res.status}): ${text.slice(0, 200)}`)
  }

  return res.json() as Promise<TermiiResponse>
}
