import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

// NOTE: NDPR data EXPORT lives at GET /api/auth/export (its own route) — the
// profile UI links there. This file owns only account DELETION.

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

  // Block deletion ONLY if a genuinely IN-FLIGHT order exists — i.e. one being
  // actively fulfilled, where deleting now would strand a live delivery. Use a
  // WHITELIST (not "anything non-terminal"): the old blacklist also caught
  // abandoned PENDING_PAYMENT checkouts and DELIVERED orders that never
  // auto-completed (the cron is unreliable), wrongly blocking deletion forever
  // even when the customer has nothing actually in progress.
  const IN_FLIGHT = ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'PICKED_UP']
  const { data: activeOrders } = await db
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', IN_FLIGHT)
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
  res.cookies.set(sessionCookieName(), '', { maxAge: 0, path: '/' })
  return res
}
