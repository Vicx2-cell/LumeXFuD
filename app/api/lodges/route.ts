import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/lodges — verified, active ABSU lodges for the cart picker + map.
// Returns only safe columns (never created_by). Requires a session so the
// location list isn't public to the anon key. Degrades to [] if migration 051
// hasn't run.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ lodges: [] })

  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('lodges')
      .select('id, name, area, latitude, longitude')
      .eq('is_active', true)
      .eq('is_verified', true)
      .order('name', { ascending: true })
      .limit(500)
    return NextResponse.json({ lodges: data ?? [] })
  } catch {
    return NextResponse.json({ lodges: [] })
  }
}
