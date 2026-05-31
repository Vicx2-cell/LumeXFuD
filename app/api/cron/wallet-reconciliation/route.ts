import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { formatPrice } from '@/lib/wallet'

// Called daily at 6am by Vercel cron.
// Compares sum of all wallet_balances against Paystack account balance.
// If divergence > ₦100 (10,000 kobo): freezes all withdrawals and alerts admin.

const TOLERANCE_KOBO = 10_000 // ₦100

interface PaystackBalanceResponse {
  status: boolean
  data: Array<{ currency: string; balance: number }>
}

async function getPaystackBalance(): Promise<number> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const res = await fetch('https://api.paystack.co/balance', {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Paystack balance API failed: ${res.status}`)

  const json = (await res.json()) as PaystackBalanceResponse
  if (!json.status || !Array.isArray(json.data)) throw new Error('Invalid Paystack balance response')

  // Paystack returns balance in kobo
  const ngn = json.data.find((b) => b.currency === 'NGN')
  return ngn?.balance ?? 0
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()

  // Sum all wallet balances
  const { data: sumRaw, error: sumError } = await db
    .from('wallet_balances')
    .select('total_balance')

  if (sumError) {
    console.error('[cron/wallet-reconciliation] Sum query failed:', sumError.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const walletTotal = (sumRaw ?? []).reduce(
    (acc, row) => acc + Number((row as { total_balance: number }).total_balance),
    0
  )

  // Get Paystack balance
  let paystackBalance: number
  try {
    paystackBalance = await getPaystackBalance()
  } catch (err) {
    console.error('[cron/wallet-reconciliation] Paystack balance fetch failed:', err)
    // Don't freeze on API error — log and exit
    await audit({
      actor_id:   'cron',
      actor_role: 'system',
      action:     'RECONCILIATION_ERROR',
      new_value:  { error: String(err) },
    })
    return NextResponse.json({ error: 'Failed to fetch Paystack balance' }, { status: 502 })
  }

  const difference = Math.abs(paystackBalance - walletTotal)

  if (difference > TOLERANCE_KOBO) {
    // CRITICAL: freeze all withdrawals and alert admin
    await db
      .from('settings')
      .upsert({ id: 'withdrawals_frozen', value: true }, { onConflict: 'id' })

    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone) {
      sendWhatsAppWithFallback({
        to: adminPhone,
        message: `🚨 URGENT: Wallet reconciliation FAILED!\n\nWallet total: ${formatPrice(walletTotal)}\nPaystack balance: ${formatPrice(paystackBalance)}\nDifference: ${formatPrice(difference)}\n\nAll withdrawals have been frozen. Investigate immediately.`,
      }).catch(() => {})
    }

    await audit({
      actor_id:   'cron',
      actor_role: 'system',
      action:     'RECONCILIATION_FAILURE',
      new_value:  {
        wallet_total:      walletTotal,
        paystack_balance:  paystackBalance,
        difference_kobo:   difference,
        withdrawals_frozen: true,
      },
    })

    console.error(`[cron/wallet-reconciliation] MISMATCH: wallet=${walletTotal} paystack=${paystackBalance} diff=${difference}`)
    return NextResponse.json({
      status:    'MISMATCH',
      wallet:    walletTotal,
      paystack:  paystackBalance,
      difference,
      frozen:    true,
    })
  }

  // All good — log success
  await audit({
    actor_id:   'cron',
    actor_role: 'system',
    action:     'RECONCILIATION_SUCCESS',
    new_value:  {
      wallet_total:     walletTotal,
      paystack_balance: paystackBalance,
      difference_kobo:  difference,
    },
  })

  return NextResponse.json({
    status:    'OK',
    wallet:    walletTotal,
    paystack:  paystackBalance,
    difference,
  })
}
