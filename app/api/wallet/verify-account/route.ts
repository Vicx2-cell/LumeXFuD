import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { z } from 'zod'

const schema = z.object({
  account_number: z.string().length(10).regex(/^\d{10}$/),
  bank_code:      z.string().min(3).max(10).regex(/^\d{3,10}$/),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Proxies a paid Paystack name-resolve call — cap at 5 / 10 min per user to
  // stop bank-account enumeration and cost abuse.
  const rl = await rateLimitGeneric(`wallet-verifyacct:${session.userId ?? session.phone}`, 5, 600)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { account_number, bank_code } = parsed.data
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return NextResponse.json({ error: 'Payment service misconfigured' }, { status: 500 })

  const url = `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)

  if (!res || !res.ok) {
    return NextResponse.json(
      { error: 'Could not verify account. Check account number and bank.' },
      { status: 422 }
    )
  }

  const json = (await res.json()) as { status: boolean; data?: { account_name: string } }
  if (!json.status || !json.data?.account_name) {
    return NextResponse.json(
      { error: 'Account not found. Check account number and bank.' },
      { status: 422 }
    )
  }

  return NextResponse.json({ account_name: json.data.account_name })
}
