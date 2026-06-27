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
    // Try the richer select (with blocks); fall back to base columns if the
    // blocks column isn't there yet (migration 081 pending) so the picker never
    // breaks. Empty `blocks` simply means the lodge has no defined blocks.
    const rich = await db
      .from('lodges')
      .select('id, name, area, latitude, longitude, blocks')
      .eq('is_active', true)
      .eq('is_verified', true)
      .order('name', { ascending: true })
      .limit(500)
    if (!rich.error) return NextResponse.json({ lodges: rich.data ?? [] })
    const base = await db
      .from('lodges')
      .select('id, name, area, latitude, longitude')
      .eq('is_active', true)
      .eq('is_verified', true)
      .order('name', { ascending: true })
      .limit(500)
    return NextResponse.json({ lodges: base.data ?? [] })
  } catch {
    return NextResponse.json({ lodges: [] })
  }
}
