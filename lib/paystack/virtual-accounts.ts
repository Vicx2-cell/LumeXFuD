import 'server-only'

const base = 'https://api.paystack.co'

async function paystack<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })
  const json = await response.json() as { status: boolean; message?: string; data: T }
  if (!response.ok || !json.status) throw new Error(json.message ?? `Paystack request failed (${response.status})`)
  return json.data
}

export type PaystackDva = {
  bank: { name: string; slug: string }
  account_name: string
  account_number: string
  customer?: { customer_code?: string }
}

export async function createPaystackCustomer(input: { email: string; firstName: string; lastName: string; phone: string }) {
  return paystack<{ customer_code: string }>('/customer', {
    method: 'POST',
    body: JSON.stringify({ email: input.email, first_name: input.firstName, last_name: input.lastName, phone: input.phone }),
  })
}

export async function fetchPaystackCustomer(emailOrCode: string) {
  return paystack<{ customer_code: string }>(`/customer/${encodeURIComponent(emailOrCode)}`)
}

export async function assignDedicatedAccount(input: {
  email: string; firstName: string; lastName: string; phone: string
  preferredBank?: string; accountNumber?: string; bankCode?: string; bvn?: string
}) {
  const body: Record<string, string> = {
    email: input.email, first_name: input.firstName, last_name: input.lastName,
    phone: input.phone, country: 'NG',
  }
  if (input.preferredBank) body.preferred_bank = input.preferredBank
  if (input.accountNumber) body.account_number = input.accountNumber
  if (input.bankCode) body.bank_code = input.bankCode
  if (input.bvn) body.bvn = input.bvn
  return paystack<PaystackDva | undefined>('/dedicated_account/assign', { method: 'POST', body: JSON.stringify(body) })
}

export async function requeryDedicatedAccount(accountNumber: string, providerSlug: string) {
  const query = new URLSearchParams({ account_number: accountNumber, provider_slug: providerSlug, date: new Date().toISOString().slice(0, 10) })
  return paystack<unknown>(`/dedicated_account/requery?${query}`)
}

export function maskIdentity(input: { accountNumber?: string; bankCode?: string }) {
  return {
    validation_method: input.accountNumber ? 'bank_account' : 'provider_optional',
    account_last4: input.accountNumber?.slice(-4) ?? null,
    bank_code: input.bankCode ?? null,
  }
}
