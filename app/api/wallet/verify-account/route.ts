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

  if (!res) {
    return NextResponse.json(
      { error: 'Could not reach the bank service. Check your connection and try again.' },
      { status: 502 }
    )
  }

  const json = (await res.json().catch(() => null)) as
    | { status?: boolean; message?: string; data?: { account_name?: string } }
    | null

  if (!res.ok || !json?.status || !json.data?.account_name) {
    // Surface Paystack's actual reason — it tells us WHY (e.g. an un-activated
    // Paystack business can't resolve names, test keys don't resolve real
    // accounts, and some fintech wallets aren't resolvable). Without this the
    // user just sees a generic "not found" and we can't diagnose.
    console.error('[verify-account] Paystack resolve failed', { httpStatus: res.status, message: json?.message })
    return NextResponse.json(
      { error: json?.message || 'Account could not be verified. Check the account number and bank.' },
      { status: 422 }
    )
  }

  return NextResponse.json({ account_name: json.data.account_name })
}
