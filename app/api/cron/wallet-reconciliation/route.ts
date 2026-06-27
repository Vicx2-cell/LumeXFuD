import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { formatPrice } from '@/lib/wallet'

// Called daily at 6am by Vercel cron.
//
// The dangerous condition is a SHORTFALL: the real money in Paystack is less
// than what we OWE users (vendor/rider wallets + customer wallet float). That
// means user-owed funds aren't actually in the bank → freeze withdrawals.
//
// A SURPLUS (Paystack >= liabilities) is benign and expected — the float also
// holds in-flight order money (paid, not yet released to anyone) and retained
// platform revenue. The old code compared the full Paystack balance to ONLY the
// vendor/rider wallet total and froze on ANY difference > ₦100, so in production
// it would auto-freeze every payout the moment a customer topped up or an order
// was paid. Comparing against true liabilities and freezing only on shortfall
// fixes that false-freeze.

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

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('wallet-reconciliation', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()

  // Liability leg 1: vendor/rider wallets — money earned but not yet withdrawn
  // (held + available, i.e. total_balance).
  const { data: vrRaw, error: vrError } = await db
    .from('wallet_balances')
    .select('total_balance')

  if (vrError) {
    console.error('[cron/wallet-reconciliation] wallet_balances query failed:', vrError.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const vendorRiderTotal = (vrRaw ?? []).reduce(
    (acc, row) => acc + Number((row as { total_balance: number }).total_balance),
    0
  )

  // Liability leg 2: customer wallet float — money customers loaded but haven't
  // spent yet. This is real custodied money sitting in Paystack and MUST be
  // counted, otherwise reconciliation under-states what we owe.
  const { data: cwRaw, error: cwError } = await db
    .from('customer_wallets')
    .select('balance_kobo')

  if (cwError) {
    console.error('[cron/wallet-reconciliation] customer_wallets query failed:', cwError.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const customerFloat = (cwRaw ?? []).reduce(
    (acc, row) => acc + Number((row as { balance_kobo: number }).balance_kobo),
    0
  )

  // Total money we OWE users and must be able to pay out at any moment.
  const liabilities = vendorRiderTotal + customerFloat

  // Reward-credit liability (migration 082): promo credits we've issued but not
  // yet redeemed/expired. This is a REAL liability we track, but it is NOT
  // custodied user cash — it's a future DISCOUNT funded from platform revenue, so
  // it must NOT enter the withdrawal-shortfall math (doing so would false-freeze).
  // We surface it for exposure visibility only. Non-fatal: 0 if migration unrun.
  let rewardLiability = 0
  try {
    const { data: rcRaw } = await db
      .from('reward_credits')
      .select('remaining_kobo')
      .in('status', ['ACTIVE', 'RESERVED'])
    rewardLiability = (rcRaw ?? []).reduce((acc, row) => acc + Number((row as { remaining_kobo: number }).remaining_kobo), 0)
  } catch { /* table absent — treat as 0 */ }

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

  // Shortfall (positive) = we owe more than Paystack is holding → DANGER.
  // Surplus (negative)   = float exceeds liabilities (in-flight orders + retained
  //                        platform revenue) → benign, never freeze on this.
  const shortfall = liabilities - paystackBalance

  if (shortfall > TOLERANCE_KOBO) {
    // CRITICAL: real shortfall — freeze all withdrawals and alert admin
    await db
      .from('settings')
      .upsert({ id: 'withdrawals_frozen', value: true }, { onConflict: 'id' })

    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone) {
      sendWhatsAppWithFallback({
        to: adminPhone,
        message:
          `🚨 URGENT: Wallet reconciliation SHORTFALL!\n\n` +
          `Owed to users: ${formatPrice(liabilities)}\n` +
          `  • vendor/rider: ${formatPrice(vendorRiderTotal)}\n` +
          `  • customer float: ${formatPrice(customerFloat)}\n` +
          `Paystack balance: ${formatPrice(paystackBalance)}\n` +
          `Shortfall: ${formatPrice(shortfall)}\n` +
          `(Promo credits outstanding: ${formatPrice(rewardLiability)} — not in shortfall)\n\n` +
          `All withdrawals have been frozen. Investigate immediately.`,
      }).catch(() => {})
    }

    await audit({
      actor_id:   'cron',
      actor_role: 'system',
      action:     'RECONCILIATION_FAILURE',
      new_value:  {
        liabilities,
        vendor_rider_total: vendorRiderTotal,
        customer_float:     customerFloat,
        paystack_balance:   paystackBalance,
        shortfall_kobo:     shortfall,
        reward_liability:   rewardLiability,
        withdrawals_frozen: true,
      },
    })

    console.error(`[cron/wallet-reconciliation] SHORTFALL: owed=${liabilities} paystack=${paystackBalance} shortfall=${shortfall}`)
    return NextResponse.json({
      status:     'SHORTFALL',
      liabilities,
      vendor_rider_total: vendorRiderTotal,
      customer_float:     customerFloat,
      reward_liability:   rewardLiability,
      paystack:           paystackBalance,
      shortfall,
      frozen:             true,
    })
  }

  // Healthy — Paystack covers all user liabilities. Surplus is expected.
  const surplus = paystackBalance - liabilities
  await audit({
    actor_id:   'cron',
    actor_role: 'system',
    action:     'RECONCILIATION_SUCCESS',
    new_value:  {
      liabilities,
      vendor_rider_total: vendorRiderTotal,
      customer_float:     customerFloat,
      paystack_balance:   paystackBalance,
      surplus_kobo:       surplus,
      reward_liability:   rewardLiability,
    },
  })

  return NextResponse.json({
    status:     'OK',
    liabilities,
    vendor_rider_total: vendorRiderTotal,
    customer_float:     customerFloat,
    reward_liability:   rewardLiability,
    paystack:           paystackBalance,
    surplus,
  })
}
