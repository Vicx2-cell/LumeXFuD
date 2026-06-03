import { NextRequest, NextResponse } from 'next/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { loginPinInput } from '@/lib/validators'
import { compareSecret, findAuthUserByPhone, getRoleRedirect, hashSecret } from '@/lib/pin-auth'
import { rateLimitPinLogin } from '@/lib/rate-limit'

const LOCKOUT_MINUTES = 30

// Required env var — startup validation in lib/env.ts ensures this is set
const SUPER_ADMIN_DEFAULT_PIN = process.env.SUPER_ADMIN_DEFAULT_PIN!

async function ensureSuperAdminBootstrap(phone: string, pin: string) {
  if (phone !== process.env.SUPER_ADMIN_PHONE) return null
  if (pin !== SUPER_ADMIN_DEFAULT_PIN) return null
  const db = createSupabaseAdmin()
  const { data: existingCustomer } = await db.from('customers').select('*').eq('phone', phone).maybeSingle()
  if (existingCustomer) return { role: 'super_admin' as const, table: 'customers', user: existingCustomer }

  const pinHash = await hashSecret(pin)
  const { data: user, error } = await db.from('customers').insert({
    phone,
    name: 'Super Admin',
    login_pin_hash: pinHash,
    pin_attempts: 0,
    pin_locked_until: null,
    pin_reset_pending: false,
    recovery_attempts: 0,
    recovery_locked_until: null,
  }).select('*').single()
  if (error || !user) return null
  return { role: 'super_admin' as const, table: 'customers', user }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone, pin } = loginPinInput.parse(body)
    const normalizedPhone = phone.trim()

    const limit = await rateLimitPinLogin(normalizedPhone)
    if (!limit.success) {
      const retryAt = new Date(Date.now() + limit.reset * 1000)
      return NextResponse.json(
        { error: `Too many login attempts. Try again after ${retryAt.toLocaleTimeString()}.` },
        { status: 429 }
      )
    }

    let user = await findAuthUserByPhone(normalizedPhone)
    if (!user) {
      user = await ensureSuperAdminBootstrap(normalizedPhone, pin)
    }
    if (!user || !user.user.login_pin_hash) {
      await compareSecret(pin, null)
      return NextResponse.json({ error: 'Invalid phone or PIN' }, { status: 400 })
    }

    const lockUntil = user.user.pin_locked_until ? new Date(user.user.pin_locked_until) : null
    if (lockUntil && lockUntil > new Date()) {
      return NextResponse.json(
        { error: `Account locked until ${lockUntil.toLocaleTimeString()}.` },
        { status: 423 }
      )
    }

    let passwordMatch = await compareSecret(pin, user.user.login_pin_hash)
    const shouldAllowDefaultSuperAdminPin =
      !passwordMatch &&
      user.role === 'super_admin' &&
      normalizedPhone === process.env.SUPER_ADMIN_PHONE &&
      pin === SUPER_ADMIN_DEFAULT_PIN

    if (shouldAllowDefaultSuperAdminPin) {
      const db = createSupabaseAdmin()
      const defaultHash = await hashSecret(pin)
      await db.from(user.table).update({
        login_pin_hash: defaultHash,
        pin_attempts: 0,
        pin_locked_until: null,
      }).eq('id', user.user.id)
      passwordMatch = true
    }

    if (!passwordMatch) {
      const db = createSupabaseAdmin()
      const attempts = (user.user.pin_attempts ?? 0) + 1
      const updates: Record<string, unknown> = { pin_attempts: attempts }
      if (attempts >= 5) {
        updates.pin_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
      }
      await db.from(user.table).update(updates).eq('id', user.user.id)
      return NextResponse.json({ error: 'Invalid phone or PIN' }, { status: 400 })
    }

    const db = createSupabaseAdmin()
    await db.from(user.table).update({
      pin_attempts: 0,
      pin_locked_until: null,
    }).eq('id', user.user.id)

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined
    // Use the canonical E.164 phone stored on the user row, NOT the raw login
    // input — the JWT phone drives every downstream `.eq('phone', ...)` lookup
    // and the RLS `auth.jwt() ->> 'phone'` checks (rule #2).
    const { token } = await createSession(user.user.id, user.user.phone, user.role, ipAddress, userAgent)

    const res = NextResponse.json({
      role: user.role,
      redirect_path: getRoleRedirect(user.role),
      pin_reset_pending: user.user.pin_reset_pending ?? false,
    })
    res.cookies.set('session', token, setCookieOptions(user.role))
    return res
  } catch (error) {
    console.error('[auth/login] error', error)
    return NextResponse.json({ error: 'Invalid login payload' }, { status: 400 })
  }
}
