import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, type SessionRole } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
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
  const token = req.cookies.get(sessionCookieName())?.value
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

// PATCH /api/auth/me — update the current user's editable profile fields.
// (Customer: name, hostel, room_number.) Verifies the session the same way GET
// does, then updates only the provided, trimmed fields on the user's own row.
export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(sessionCookieName())?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const payload = await verifySessionToken(token)
  if (!payload) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

  const db = createSupabaseAdmin()
  const { data: session } = await db
    .from('sessions')
    .select('id')
    .eq('id', payload.sessionId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single()
  if (!session) return NextResponse.json({ error: 'Session expired or revoked' }, { status: 401 })

  let body: { name?: unknown; hostel?: unknown; room_number?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (payload.role !== 'customer') {
    return NextResponse.json({ error: 'Profile editing not supported for this account' }, { status: 400 })
  }

  const update: Record<string, string | null> = {}
  if (typeof body.name === 'string') update.name = body.name.trim().slice(0, 80) || null
  if (typeof body.hostel === 'string') update.hostel = body.hostel.trim().slice(0, 120) || null
  if (typeof body.room_number === 'string') update.room_number = body.room_number.trim().slice(0, 40) || null

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await db
    .from('customers')
    .update(update)
    .eq('phone', payload.phone)
    .is('deleted_at', null)
  if (error) {
    console.error('[auth/me PATCH] update error:', error.message)
    return NextResponse.json({ error: 'Could not save your details' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
