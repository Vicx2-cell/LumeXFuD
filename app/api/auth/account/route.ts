import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, COOKIE_NAME } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { maskPhone } from '@/lib/phone'

// DELETE /api/auth/account — NDPR account deletion
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can be deleted via this endpoint' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  // Block deletion if active orders exist
  const { data: activeOrders } = await db
    .from('orders')
    .select('id')
    .eq('customer_id', (await db.from('customers').select('id').eq('phone', user.phone).single()).data?.id ?? '')
    .not('status', 'in', '("COMPLETED","CANCELLED","REFUNDED")')
    .limit(1)

  if (activeOrders && activeOrders.length > 0) {
    return NextResponse.json(
      { error: 'Cannot delete account while you have active orders. Please wait for them to complete.' },
      { status: 409 }
    )
  }

  // Soft delete + anonymize
  const anonymizedPhone = `DELETED_${Date.now()}_${user.phone.slice(-4)}`
  await db
    .from('customers')
    .update({
      phone: anonymizedPhone,
      name: null,
      hostel: null,
      room_number: null,
      default_delivery_address: null,
      deleted_at: new Date().toISOString(),
    })
    .eq('phone', user.phone)

  // Revoke all sessions
  await db
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', user.sessionId)

  await audit({
    actor_id: user.phone,
    actor_role: user.role,
    action: 'ACCOUNT_DELETED',
    target_table: 'customers',
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    user_agent: req.headers.get('user-agent') ?? undefined,
  })

  const res = NextResponse.json({ success: true })
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
  return res
}

// GET /api/auth/export — NDPR data export
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'customer') {
    return NextResponse.json({ error: 'Data export only available for customer accounts' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('*')
    .eq('phone', user.phone)
    .single()

  const customerId = customer?.id

  const [ordersRes, ratingsRes, messagesRes, xpRes, badgesRes] = await Promise.all([
    customerId
      ? db.from('orders').select('*, order_items(*)').eq('customer_id', customerId)
      : Promise.resolve({ data: [] }),
    customerId
      ? db.from('ratings').select('*').eq('customer_id', customerId)
      : Promise.resolve({ data: [] }),
    customerId
      ? db.from('order_messages').select('*').eq('sender_id', customerId)
      : Promise.resolve({ data: [] }),
    customerId
      ? db.from('customer_xp').select('*').eq('customer_id', customerId).single()
      : Promise.resolve({ data: null }),
    customerId
      ? db.from('customer_badges').select('*, badges(*)').eq('customer_id', customerId)
      : Promise.resolve({ data: [] }),
  ])

  const exportData = {
    exported_at: new Date().toISOString(),
    account: { ...customer, phone: maskPhone(customer?.phone ?? '') },
    orders: ordersRes.data ?? [],
    ratings: ratingsRes.data ?? [],
    messages: messagesRes.data ?? [],
    gamification: {
      xp: xpRes.data,
      badges: badgesRes.data ?? [],
    },
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
