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
      .select('id, hostel, room_number')
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

    const addresses = (data ?? []).map((r) => (r as { address: string }).address)

    // Offer the saved profile hostel/room as a delivery option too (so a customer
    // who set it in their profile sees it at checkout, even before any orders).
    const c = customer as { hostel: string | null; room_number: string | null }
    const profileAddr = [c.hostel?.trim(), c.room_number?.trim()].filter(Boolean).join(', ')
    if (profileAddr && !addresses.some((a) => a.toLowerCase() === profileAddr.toLowerCase())) {
      addresses.push(profileAddr)
    }

    return NextResponse.json({ addresses })
  } catch {
    return NextResponse.json({ addresses: [] })
  }
}
