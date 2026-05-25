interface PaystackInitParams {
  email: string
  amount: number // in kobo
  reference: string
  callback_url: string
  metadata?: Record<string, unknown>
}

interface PaystackInitResponse {
  authorization_url: string
  access_code: string
  reference: string
}

export async function initializePaystackTransaction(
  params: PaystackInitParams
): Promise<PaystackInitResponse> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Paystack init failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as { status: boolean; data: PaystackInitResponse }
  if (!json.status) throw new Error('Paystack returned status=false on init')
  return json.data
}

export async function verifyPaystackTransaction(reference: string): Promise<{
  status: string
  amount: number
  reference: string
  metadata: Record<string, unknown>
}> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Paystack verify failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as { status: boolean; data: Record<string, unknown> }
  if (!json.status) throw new Error('Paystack verify returned status=false')
  return json.data as {
    status: string
    amount: number
    reference: string
    metadata: Record<string, unknown>
  }
}
