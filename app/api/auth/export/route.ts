import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { maskPhone } from '@/lib/phone'
import { rateLimitGeneric } from '@/lib/rate-limit'

// GET /api/auth/export — NDPR data export. (This is the path the profile UI links
// to; it previously lived under /api/auth/account, so the link 404'd.)
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'customer') {
    return NextResponse.json({ error: 'Data export only available for customer accounts' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`auth-account-export:${user.userId ?? user.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()

  // Explicit columns only — never select('*') here: the customers row holds
  // login_pin_hash / recovery_code_hash / security_answer hashes, which must
  // never appear in a user-facing data export (rules #14/#16).
  const { data: customer } = await db
    .from('customers')
    .select('id, phone, name, hostel, room_number, default_delivery_address, dispute_count, created_at, updated_at')
    .eq('phone', user.phone)
    .single()

  const customerId = customer?.id

  // Gather the personal data we hold for this customer. Each query degrades to []
  // so a missing table (un-run migration) never breaks the export.
  async function rows(run: () => PromiseLike<{ data: unknown[] | null }>): Promise<unknown[]> {
    if (!customerId) return []
    try {
      const { data } = await run()
      return data ?? []
    } catch {
      return []
    }
  }

  const [orders, savedAddresses, savedPlaces, ratings] = await Promise.all([
    rows(() => db.from('orders').select('*, order_items(*)').eq('customer_id', customerId)),
    rows(() => db.from('customer_addresses').select('address, latitude, longitude, use_count, last_used_at, created_at').eq('customer_id', customerId)),
    rows(() => db.from('saved_places').select('label, landmark, latitude, longitude, is_default, use_count, last_used_at, created_at').eq('customer_id', customerId)),
    rows(() => db.from('ratings').select('order_id, vendor_rating, vendor_review, rider_rating, created_at').eq('customer_id', customerId)),
  ])

  const exportData = {
    exported_at: new Date().toISOString(),
    account: { ...customer, phone: maskPhone(customer?.phone ?? '') },
    orders,
    saved_addresses: savedAddresses,
    saved_places: savedPlaces,
    ratings,
  }

  await audit({
    actor_id: user.phone,
    actor_role: user.role,
    action: 'DATA_EXPORT',
    target_table: 'customers',
  })

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="lumexfud-data-export-${Date.now()}.json"`,
    },
  })
}
