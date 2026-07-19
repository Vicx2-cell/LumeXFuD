export interface TransactionalEmail {
  to: string
  subject: string
  text: string
  html?: string
}

function defaultFrom(): string {
  return process.env.EMAIL_FROM?.trim() || 'LumeX Fud <hello@lumexfud.com.ng>'
}

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not configured; skipping email send')
    return
  }

  const from = defaultFrom()
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html ?? message.text.replace(/\n/g, '<br />'),
    }),
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Transactional email failed: ${response.status} ${details}`.trim())
  }
}
