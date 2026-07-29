import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await createSupabaseAdmin().rpc('release_expired_promo_reservations')
  if (error) return NextResponse.json({ error: 'Could not release reservations' }, { status: 500 })
  return NextResponse.json({ released: Number(data ?? 0) })
}
