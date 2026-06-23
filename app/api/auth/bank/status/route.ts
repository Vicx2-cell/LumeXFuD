import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/auth/bank/status — does the signed-in vendor/rider have a verified
// payout bank (and a wallet PIN, which save-bank requires)? Powers the BankGate
// that blocks the dashboard until a verified bank is on file. Customers/admins/
// super-admins are exempt. Fails OPEN (never lock anyone out on a read blip) —
// the operation endpoints enforce the same gate server-side as the hard backstop.
export async function GET() {
  const session = await getCurrentUser()
  if (!session || !session.userId) return NextResponse.json({ exempt: true, has_pin: true, has_verified_bank: true })
  if (session.role !== 'vendor' && session.role !== 'rider') {
    return NextResponse.json({ exempt: true, has_pin: true, has_verified_bank: true })
  }

  const userType = session.role === 'vendor' ? 'VENDOR' : 'RIDER'
  try {
    const db = createSupabaseAdmin()
    const { data: raw } = await db
      .from('wallet_balances')
      .select('wallet_pin_hash, bank_verified_at, bank_account_number, bank_code')
      .eq('user_id', session.userId)
      .eq('user_type', userType)
      .maybeSingle()
    const w = raw as unknown as { wallet_pin_hash: string | null; bank_verified_at: string | null; bank_account_number: string | null; bank_code: string | null } | null

    const has_pin = !!w?.wallet_pin_hash
    const has_verified_bank = !!(w?.bank_verified_at && w?.bank_account_number && w?.bank_code)
    return NextResponse.json({ exempt: false, has_pin, has_verified_bank })
  } catch {
    return NextResponse.json({ exempt: true, has_pin: true, has_verified_bank: true }) // never lock out on a blip
  }
}
