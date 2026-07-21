import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { createSupabaseAdmin } from './supabase/server'
import { safeNormalizePhone } from './phone'
import { sessionCookieName } from './session-cookie'

export type SessionRole = 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'

export interface SessionPayload {
  sessionId: string
  userId?: string
  phone: string
  role: SessionRole
  name?: string
  pin_reset_pending?: boolean
}

export type UserRole = SessionRole

export type DetectRoleResult = {
  role: UserRole
  userId: string
  tableName: string
} | null

// Shape of the per-role name/pin lookup in createSession. The display-name
// column differs by table (name / owner_name / full_name), so all variants
// are optional.
type AuthNameRow = {
  name?: string | null
  owner_name?: string | null
  full_name?: string | null
  pin_reset_pending?: boolean | null
}

type SessionSubjectRow = {
  id?: string | null
  phone?: string | null
  is_active?: boolean | null
  role?: string | null
  suspended_until?: string | null
  deleted_at?: string | null
}

const SESSION_DURATIONS: Record<SessionRole, number> = {
  customer:   24 * 60 * 60,
  vendor:      8 * 60 * 60,
  rider:      12 * 60 * 60,
  admin:       4 * 60 * 60,
  super_admin: 2 * 60 * 60,
}

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET not set')
  // Reject a weak signing key at RUNTIME, not just in the security-health page.
  // HS256 with a short secret is brute-forceable; fail closed rather than mint
  // forgeable tokens. 32 chars is the floor; 64 is the documented target.
  if (s.length < 32) throw new Error('JWT_SECRET too short — use a 64-char random secret')
  return new TextEncoder().encode(s)
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const expiresIn = SESSION_DURATIONS[payload.role]
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(getSecret())
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    // Pin the algorithm on verify — never let the token's own header pick it.
    // Our tokens are always HS256 (see signSessionToken); accepting anything
    // else invites algorithm-substitution attacks.
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (
      typeof payload.sessionId !== 'string' ||
      typeof payload.phone !== 'string' ||
      typeof payload.role !== 'string'
    ) return null
    return {
      sessionId: payload.sessionId,
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      phone: payload.phone,
      role: payload.role as SessionRole,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      pin_reset_pending: typeof payload.pin_reset_pending === 'boolean' ? payload.pin_reset_pending : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Detect the user's role and return the user id and table name.
 * Follows priority: super_admin -> admin -> vendor -> rider -> customer
 */
export async function detectRole(phone: string): Promise<DetectRoleResult> {
  const db = createSupabaseAdmin()

  // Normalize configured phones (env may be 08../234../+234.. or have whitespace)
  // so the role match is format-agnostic, not a brittle raw-string compare.
  const superAdminPhone = safeNormalizePhone(process.env.SUPER_ADMIN_PHONE)
  const adminPhone = safeNormalizePhone(process.env.ADMIN_PHONE)

  // 1. Super admin (stored in customers table)
  if (superAdminPhone && phone === superAdminPhone) {
    const { data: customer, error } = await db
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()
    if (!error && customer) return { role: 'super_admin', userId: customer.id, tableName: 'customers' }
  }

  // 2. Admin (operational admin stored in customers table)
  if (adminPhone && phone === adminPhone) {
    const { data: customer, error } = await db
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()
    if (!error && customer) return { role: 'admin', userId: customer.id, tableName: 'customers' }
  }

  // 3. Vendor
  const { data: vendor, error: vErr } = await db
    .from('vendors')
    .select('id,is_active')
    .eq('phone', phone)
    .maybeSingle()
  if (!vErr && vendor && vendor.is_active) {
    return { role: 'vendor', userId: vendor.id, tableName: 'vendors' }
  }

  // 4. Rider
  const { data: rider, error: rErr } = await db
    .from('riders')
    .select('id,is_active')
    .eq('phone', phone)
    .maybeSingle()
  if (!rErr && rider && rider.is_active) {
    return { role: 'rider', userId: rider.id, tableName: 'riders' }
  }

  // 5. Default: customer
  const { data: customer, error: cErr } = await db
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()
  if (!cErr && customer) return { role: 'customer', userId: customer.id, tableName: 'customers' }

  return null
}

export async function createSession(
  userId: string,
  phone: string,
  role: SessionRole,
  ipAddress?: string,
  userAgent?: string
): Promise<{ token: string; sessionId: string }> {
  const db = createSupabaseAdmin()
  const expiresAt = new Date(Date.now() + SESSION_DURATIONS[role] * 1000).toISOString()

  if (!(await canIssueSession(db, userId, phone, role))) {
    throw new Error('Account is not eligible for session issuance')
  }

  const { data, error } = await db
    .from('sessions')
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      phone,
      role,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error('Failed to create session')

  const sessionId = data.id as string
  // Fetch display name and pin_reset_pending from appropriate table
  let name: string | undefined
  let pinResetPending: boolean | undefined
  try {
    if (role === 'customer') {
      const { data: u } = await db.from('customers').select('name,pin_reset_pending').eq('id', userId).maybeSingle()
      name = (u as AuthNameRow | null)?.name ?? undefined
      pinResetPending = (u as AuthNameRow | null)?.pin_reset_pending ?? undefined
    } else if (role === 'vendor') {
      const { data: u } = await db.from('vendors').select('owner_name,pin_reset_pending').eq('id', userId).maybeSingle()
      name = (u as AuthNameRow | null)?.owner_name ?? undefined
      pinResetPending = (u as AuthNameRow | null)?.pin_reset_pending ?? undefined
    } else if (role === 'rider') {
      const { data: u } = await db.from('riders').select('full_name,pin_reset_pending').eq('id', userId).maybeSingle()
      name = (u as AuthNameRow | null)?.full_name ?? undefined
      pinResetPending = (u as AuthNameRow | null)?.pin_reset_pending ?? undefined
    } else if (role === 'admin') {
      const { data: u } = await db.from('admins').select('name,pin_reset_pending').eq('id', userId).maybeSingle()
      name = (u as AuthNameRow | null)?.name ?? undefined
      pinResetPending = (u as AuthNameRow | null)?.pin_reset_pending ?? undefined
    } else if (role === 'super_admin') {
      const { data: u } = await db.from('customers').select('name,pin_reset_pending').eq('id', userId).maybeSingle()
      if (u) {
        name = (u as AuthNameRow | null)?.name ?? undefined
        pinResetPending = (u as AuthNameRow | null)?.pin_reset_pending ?? undefined
      } else {
        const { data: a } = await db.from('admins').select('name,pin_reset_pending').eq('id', userId).maybeSingle()
        name = (a as AuthNameRow | null)?.name ?? undefined
        pinResetPending = (a as AuthNameRow | null)?.pin_reset_pending ?? undefined
      }
    }
  } catch {
    // ignore — token can still be issued without these fields
  }

  const token = await signSessionToken({ sessionId, userId, phone, role, name, pin_reset_pending: pinResetPending })
  return { token, sessionId }
}

function notSuspended(row: SessionSubjectRow | null): boolean {
  if (!row) return false
  if (row.deleted_at) return false
  if (!row.suspended_until) return true
  return new Date(row.suspended_until).getTime() <= Date.now()
}

function envPhoneMatches(role: Extract<SessionRole, 'admin' | 'super_admin'>, phone: string): boolean {
  const envPhone = role === 'super_admin'
    ? safeNormalizePhone(process.env.SUPER_ADMIN_PHONE)
    : safeNormalizePhone(process.env.ADMIN_PHONE)
  return Boolean(envPhone && envPhone === phone)
}

async function canIssueSession(
  db: ReturnType<typeof createSupabaseAdmin>,
  userId: string,
  phone: string,
  role: SessionRole,
): Promise<boolean> {
  try {
    if (role === 'customer') {
      const { data } = await db
        .from('customers')
        .select('id, phone, suspended_until, deleted_at')
        .eq('id', userId)
        .eq('phone', phone)
        .maybeSingle()
      return notSuspended(data as SessionSubjectRow | null)
    }

    if (role === 'vendor' || role === 'rider') {
      const table = role === 'vendor' ? 'vendors' : 'riders'
      const { data } = await db
        .from(table)
        .select('id, phone, is_active, suspended_until, deleted_at')
        .eq('id', userId)
        .eq('phone', phone)
        .maybeSingle()
      const row = data as SessionSubjectRow | null
      return notSuspended(row) && row?.is_active === true
    }

    const { data: adminRow } = await db
      .from('admins')
      .select('id, phone, role, is_active')
      .eq('id', userId)
      .eq('phone', phone)
      .maybeSingle()
    const admin = adminRow as SessionSubjectRow | null
    if (admin?.is_active === true && admin.role === role) return true

    // Legacy env-provisioned admin/super-admin accounts may live in customers.
    // They are valid only for the exact configured privileged phone.
    if (envPhoneMatches(role, phone)) {
      const { data: customerRow } = await db
        .from('customers')
        .select('id, phone, suspended_until, deleted_at')
        .eq('id', userId)
        .eq('phone', phone)
        .maybeSingle()
      return notSuspended(customerRow as SessionSubjectRow | null)
    }

    return false
  } catch {
    return false
  }
}

export function setCookieOptions(role: SessionRole) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 'lax' (not 'strict'): Strict withholds the session cookie on top-level
    // navigations that don't originate from the site itself — Home Screen / PWA
    // launches and links opened from other apps (WhatsApp, Messages). On iOS that
    // meant the dashboard loaded without the cookie, the proxy saw no auth, and
    // the page failed to load while desktop (same-site navigation) worked. Lax
    // still blocks CSRF on cross-site POSTs/subresources but sends the cookie on
    // top-level GET navigations.
    sameSite: 'lax' as const,
    maxAge: SESSION_DURATIONS[role],
    path: '/',
  }
}

/**
 * Is this session row still live (exists, not revoked, not expired)?
 *
 * FAIL CLOSED: any inability to CONFIRM liveness — a thrown error, a timeout, a
 * Supabase blip, or simply no matching row — returns false (treated as DEAD).
 * It must NEVER fail open: a revoked or re-keyed token must never survive a DB
 * hiccup. Shared by getCurrentUser (API/components) AND the edge proxy so both
 * gates enforce revocation identically.
 */
export async function isSessionLive(sessionId: string): Promise<boolean> {
  try {
    const db = createSupabaseAdmin()
    const { data, error } = await db
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (error) return false   // cannot confirm → DEAD
    return !!data             // no row → DEAD; row → live
  } catch {
    return false              // thrown / timeout → DEAD
  }
}

/** Retrieve and verify the current user from the session cookie (server-side). */
export async function getCurrentUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionCookieName())?.value
  if (!token) return null

  const payload = await verifySessionToken(token)
  if (!payload) return null

  // Server-side revocation/expiry check — fail closed (see isSessionLive).
  if (!(await isSessionLive(payload.sessionId))) return null

  // PANIC lockdown: when on, every role except super_admin is treated as
  // unauthenticated — so every API route and server component that gates on
  // getCurrentUser() instantly denies them. Dynamic import avoids a static cycle;
  // fail-open (a controls read error must never lock anyone out by accident).
  if (payload.role !== 'super_admin') {
    try {
      const { isLockedDown } = await import('./controls')
      if (await isLockedDown()) return null
    } catch { /* controls unreadable — do not lock out */ }
  }

  return payload
}
