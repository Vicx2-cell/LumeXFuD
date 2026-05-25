import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { createSupabaseAdmin } from './supabase/server'

export type SessionRole = 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'

export interface SessionPayload {
  sessionId: string
  phone: string
  role: SessionRole
}

const SESSION_DURATIONS: Record<SessionRole, number> = {
  customer:   24 * 60 * 60,
  vendor:      8 * 60 * 60,
  rider:      12 * 60 * 60,
  admin:       4 * 60 * 60,
  super_admin: 2 * 60 * 60,
}

const COOKIE_NAME = 'session'

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET not set')
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
    const { payload } = await jwtVerify(token, getSecret())
    if (
      typeof payload.sessionId !== 'string' ||
      typeof payload.phone !== 'string' ||
      typeof payload.role !== 'string'
    ) return null
    return {
      sessionId: payload.sessionId,
      phone: payload.phone,
      role: payload.role as SessionRole,
    }
  } catch {
    return null
  }
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

  const { data, error } = await db
    .from('sessions')
    .insert({
      user_id: userId,
      role,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error('Failed to create session')

  const sessionId = data.id as string
  const token = await signSessionToken({ sessionId, phone, role })
  return { token, sessionId }
}

export function setCookieOptions(role: SessionRole) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: SESSION_DURATIONS[role],
    path: '/',
  }
}

/** Retrieve and verify the current user from the session cookie (server-side). */
export async function getCurrentUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  const payload = await verifySessionToken(token)
  if (!payload) return null

  // Verify session still exists and is not revoked
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('sessions')
    .select('id')
    .eq('id', payload.sessionId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (!data) return null
  return payload
}

export { COOKIE_NAME }
