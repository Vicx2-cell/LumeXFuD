import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, COOKIE_NAME, type SessionRole } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

async function getUserDetails(phone: string, role: SessionRole) {
  const db = createSupabaseAdmin()

  if (role === 'customer') {
    const { data } = await db
      .from('customers')
      .select('id, phone, name, hostel, default_delivery_address')
      .eq('phone', phone)
      .is('deleted_at', null)
      .single()
    return data
  }
  if (role === 'vendor') {
    const { data } = await db
      .from('vendors')
      .select('id, phone, shop_name, owner_name, status, is_active')
      .eq('phone', phone)
      .is('deleted_at', null)
      .single()
    return data
  }
  if (role === 'rider') {
    const { data } = await db
      .from('riders')
      .select('id, phone, full_name, status, is_active')
      .eq('phone', phone)
      .is('deleted_at', null)
      .single()
    return data
  }
  if (role === 'admin' || role === 'super_admin') {
    const { data } = await db
      .from('admins')
      .select('id, phone, name, role')
      .eq('phone', phone)
      .single()
    return data
  }
  return null
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const payload = await verifySessionToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  // Verify session is still valid in DB
  const db = createSupabaseAdmin()
  const { data: session } = await db
    .from('sessions')
    .select('id')
    .eq('id', payload.sessionId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session expired or revoked' }, { status: 401 })
  }

  const user = await getUserDetails(payload.phone, payload.role)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({ ...user, role: payload.role })
}
