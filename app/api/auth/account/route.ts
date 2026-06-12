import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, COOKIE_NAME } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { maskPhone } from '@/lib/phone'
import { rateLimitGeneric } from '@/lib/rate-limit'

// DELETE /api/auth/account — NDPR account deletion
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'customer') {
    return NextResponse.json({ error: 'Only customer accounts can be deleted via this endpoint' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`auth-account-delete:${user.userId ?? user.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()

  const { data: cust } = await db.from('customers').select('id').eq('phone', user.phone).single()
  const customerId = cust?.id
  if (!customerId) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  // Block deletion if active orders exist
  const { data: activeOrders } = await db
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .not('status', 'in', '("COMPLETED","CANCELLED","REFUNDED")')
    .limit(1)

  if (activeOrders && activeOrders.length > 0) {
    return NextResponse.json(
      { error: 'Cannot delete account while you have active orders. Please wait for them to complete.' },
      { status: 409 }
    )
  }

  // Soft delete + anonymize
  const now = new Date().toISOString()
  const anonymizedPhone = `DELETED_${Date.now()}_${user.phone.slice(-4)}`
  await db
    .from('customers')
    .update({
      phone: anonymizedPhone,
      name: null,
      hostel: null,
      room_number: null,
      default_delivery_address: null,
      deleted_at: now,
    })
    .eq('id', customerId)

  // Revoke all sessions for this user (sessions.user_id is the customer id, NOT
  // the session id — the previous `.eq('user_id', sessionId)` matched nothing).
  await db
    .from('sessions')
    .update({ revoked_at: now })
    .eq('user_id', customerId)

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

  const [ordersRes] = await Promise.all([
    customerId
      ? db.from('orders').select('*, order_items(*)').eq('customer_id', customerId)
      : Promise.resolve({ data: [] }),
  ])

  const exportData = {
    exported_at: new Date().toISOString(),
    account: { ...customer, phone: maskPhone(customer?.phone ?? '') },
    orders: ordersRes.data ?? [],
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
