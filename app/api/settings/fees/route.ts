import { NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const FEE_KEYS = ['platform_markup_kobo', 'bike_delivery_fee_kobo', 'door_delivery_fee_kobo']

export async function GET() {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('settings')
    .select('key, value')
    .in('key', FEE_KEYS)

  const result: Record<string, number> = {}
  for (const row of data ?? []) {
    const n = parseInt(row.value, 10)
    if (!isNaN(n)) result[row.key] = n
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  })
}
