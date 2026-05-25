interface TransferRecipientParams {
  name: string
  account_number: string
  bank_code: string
}

interface TransferParams {
  amount: number // kobo
  recipient_code: string
  reference: string
  reason?: string
}

export async function createTransferRecipient(params: TransferRecipientParams): Promise<string> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const res = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'nuban',
      name: params.name,
      account_number: params.account_number,
      bank_code: params.bank_code,
      currency: 'NGN',
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Create recipient failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as { status: boolean; data: { recipient_code: string } }
  if (!json.status) throw new Error('Paystack returned status=false on create recipient')
  return json.data.recipient_code
}

export async function initiateTransfer(params: TransferParams): Promise<string> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const res = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'balance',
      amount: params.amount,
      recipient: params.recipient_code,
      reference: params.reference,
      reason: params.reason ?? 'LumeX Fud payout',
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Transfer failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as { status: boolean; data: { transfer_code: string } }
  if (!json.status) throw new Error('Paystack returned status=false on transfer')
  return json.data.transfer_code
}

export async function refundTransaction(reference: string, amount?: number): Promise<void> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const body: Record<string, unknown> = { transaction: reference, currency: 'NGN' }
  if (amount !== undefined) body.amount = amount

  const res = await fetch('https://api.paystack.co/refund', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Refund failed (${res.status}): ${text.slice(0, 300)}`)
  }
}
