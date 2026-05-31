import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { verifyWalletPin } from '@/lib/wallet'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { z } from 'zod'
import type { WalletBalance } from '@/lib/wallet'

const schema = z.object({
  account_number: z.string().length(10).regex(/^\d{10}$/),
  bank_code:      z.string().min(3).max(10),
  bank_name:      z.string().min(2).max(100),
  account_name:   z.string().min(2).max(200),
  wallet_pin:     z.string().length(4).regex(/^\d{4}$/),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { account_number, bank_code, bank_name, wallet_pin } = parsed.data
  const userType = session.role === 'vendor' ? 'VENDOR' : 'RIDER'
  const db = createSupabaseAdmin()

  // Load wallet and verify PIN
  const { data: walletRaw } = await db
    .from('wallet_balances')
    .select('wallet_pin_hash, pin_attempts, pin_locked_until')
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .maybeSingle()

  const wallet = walletRaw as unknown as Pick<WalletBalance, 'wallet_pin_hash' | 'pin_attempts' | 'pin_locked_until'> | null

  if (!wallet?.wallet_pin_hash) {
    return NextResponse.json({ error: 'Set a wallet PIN first' }, { status: 403 })
  }

  // Check PIN lockout
  if (wallet.pin_locked_until && new Date(wallet.pin_locked_until) > new Date()) {
    return NextResponse.json({ error: 'Wallet PIN locked. Try again later.' }, { status: 429 })
  }

  const pinOk = await verifyWalletPin(wallet_pin, wallet.wallet_pin_hash)
  if (!pinOk) {
    const newAttempts = (wallet.pin_attempts ?? 0) + 1
    const updates: Record<string, unknown> = { pin_attempts: newAttempts }
    if (newAttempts >= 5) {
      updates.pin_locked_until = new Date(Date.now() + 30 * 60_000).toISOString()
    }
    await db.from('wallet_balances').update(updates)
      .eq('user_id', session.userId!).eq('user_type', userType)
    const left = Math.max(0, 5 - newAttempts)
    return NextResponse.json(
      { error: `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.` },
      { status: 401 }
    )
  }

  // Re-verify account name with Paystack (never trust client-provided account_name)
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return NextResponse.json({ error: 'Payment service misconfigured' }, { status: 500 })

  const resolveUrl = `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`
  const resolveRes = await fetch(resolveUrl, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)

  if (!resolveRes || !resolveRes.ok) {
    return NextResponse.json({ error: 'Failed to re-verify account with Paystack' }, { status: 422 })
  }
  const resolveJson = (await resolveRes.json()) as { status: boolean; data?: { account_name: string } }
  if (!resolveJson.status || !resolveJson.data?.account_name) {
    return NextResponse.json({ error: 'Account could not be verified' }, { status: 422 })
  }
  const verifiedName = resolveJson.data.account_name

  // Save bank account details
  const now = new Date().toISOString()
  await db
    .from('wallet_balances')
    .update({
      bank_account_number: account_number,
      bank_code,
      bank_account_name:   verifiedName,
      bank_name,
      last_bank_added_at:  now,
      pin_attempts:        0,
      updated_at:          now,
    })
    .eq('user_id', session.userId!)
    .eq('user_type', userType)

  // Log to audit
  await audit({
    actor_id:     session.phone,
    actor_role:   session.role,
    action:       'BANK_ACCOUNT_SAVED',
    target_table: 'wallet_balances',
    target_id:    session.userId!,
    new_value:    { bank_name, account_last_4: account_number.slice(-4) },
  })

  // WhatsApp notification
  const availableFrom = new Date(Date.now() + 24 * 3_600_000)
  const table = session.role === 'vendor' ? 'vendors' : 'riders'
  const nameField = session.role === 'vendor' ? 'owner_name' : 'full_name'
  const { data: userRow } = await db.from(table).select(`phone, ${nameField}`).eq('id', session.userId!).maybeSingle()
  const ur = userRow as unknown as Record<string, string> | null

  if (ur?.phone) {
    sendWhatsAppWithFallback({
      to: ur.phone,
      message: `Bank account saved: ${bank_name} ****${account_number.slice(-4)}.\nWithdrawals available from ${availableFrom.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`,
    }).catch(() => {})
  }

  return NextResponse.json({
    success: true,
    verified_name: verifiedName,
    available_from: availableFrom.toISOString(),
  })
}
