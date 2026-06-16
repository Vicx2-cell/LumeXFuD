import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/customer/addresses — the customer's remembered delivery addresses
// (lodges), most-used first. Used by the cart to pre-fill + offer quick chips.
// Degrades to an empty list if migration 050 hasn't run.
export async function GET() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ addresses: [] })
  }

  try {
    const db = createSupabaseAdmin()
    const { data: customer } = await db
      .from('customers')
      .select('id')
      .eq('phone', session.phone)
      .maybeSingle()
    if (!customer) return NextResponse.json({ addresses: [] })

    const { data } = await db
      .from('customer_addresses')
      .select('address')
      .eq('customer_id', customer.id)
      .order('use_count', { ascending: false })
      .order('last_used_at', { ascending: false })
      .limit(6)

    return NextResponse.json({ addresses: (data ?? []).map((r) => (r as { address: string }).address) })
  } catch {
    return NextResponse.json({ addresses: [] })
  }
}
