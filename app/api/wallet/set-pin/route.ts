import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { validateWalletPin, hashWalletPin, verifyWalletPin } from '@/lib/wallet'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { z } from 'zod'
import type { WalletBalance } from '@/lib/wallet'

const schema = z.object({
  pin:         z.string().length(4).regex(/^\d{4}$/),
  confirm_pin: z.string().length(4).regex(/^\d{4}$/),
  current_pin: z.string().length(4).regex(/^\d{4}$/).optional(),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Rate limit: changing a wallet PIN requires guessing current_pin — cap at
  // 5 / 15 min per user. No-ops if Upstash is unset.
  const rl = await rateLimitGeneric(`wallet-setpin:${session.userId ?? session.phone}`, 5, 900)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { pin, confirm_pin, current_pin } = parsed.data

  if (pin !== confirm_pin) {
    return NextResponse.json({ error: 'PINs do not match' }, { status: 400 })
  }

  try {
    validateWalletPin(pin)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const userType = session.role === 'vendor' ? 'VENDOR' : 'RIDER'
  const db = createSupabaseAdmin()

  // Check if PIN already exists
  const { data: walletRaw } = await db
    .from('wallet_balances')
    .select('wallet_pin_hash')
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .maybeSingle()

  const wallet = walletRaw as unknown as Pick<WalletBalance, 'wallet_pin_hash'> | null

  if (wallet?.wallet_pin_hash) {
    // Changing PIN — require current PIN
    if (!current_pin) {
      return NextResponse.json({ error: 'Current PIN required to change PIN' }, { status: 400 })
    }
    const currentOk = await verifyWalletPin(current_pin, wallet.wallet_pin_hash)
    if (!currentOk) {
      return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 })
    }
  }

  const hash = await hashWalletPin(pin)

  // Upsert wallet_balances row with new PIN hash. Surface DB errors —
  // previously this was fire-and-forget, so a failed write (e.g. the missing
  // (user_id,user_type) unique constraint, migration 032) returned success
  // while the PIN never saved, leaving users re-prompted forever.
  const { error: upsertErr } = await db
    .from('wallet_balances')
    .upsert(
      {
        user_id:        session.userId!,
        user_type:      userType,
        wallet_pin_hash: hash,
        pin_attempts:   0,
        pin_locked_until: null,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'user_id,user_type' }
    )

  if (upsertErr) {
    console.error('[wallet/set-pin] upsert failed:', upsertErr.message)
    return NextResponse.json({ error: 'Could not save PIN. Please try again.' }, { status: 500 })
  }

  await audit({
    actor_id:     session.phone,
    actor_role:   session.role,
    action:       wallet?.wallet_pin_hash ? 'WALLET_PIN_CHANGED' : 'WALLET_PIN_SET',
    target_table: 'wallet_balances',
    target_id:    session.userId!,
  })

  // WhatsApp notification
  const table = session.role === 'vendor' ? 'vendors' : 'riders'
  const { data: ur } = await db.from(table).select('phone').eq('id', session.userId!).maybeSingle()
  const urCast = ur as unknown as { phone?: string } | null
  if (urCast?.phone) {
    sendWhatsAppWithFallback({
      to: urCast.phone,
      message: `Your LumeX Wallet PIN has been ${wallet?.wallet_pin_hash ? 'changed' : 'set'}. Contact support if you did not do this.`,
    }).catch(() => {})
  }

  return NextResponse.json({ success: true })
}
