import { jwtVerify, SignJWT } from 'jose'

export type SessionRole = 'customer' | 'vendor' | 'rider' | 'admin' | 'super_admin'

export interface SessionPayload {
  sessionId: string
  phone: string
  role: SessionRole
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    if (
      typeof payload.sessionId !== 'string' ||
      typeof payload.phone !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      return null
    }
    return {
      sessionId: payload.sessionId,
      phone: payload.phone,
      role: payload.role as SessionRole,
    }
  } catch {
    return null
  }
}

const SESSION_DURATIONS: Record<SessionRole, number> = {
  customer:    24 * 60 * 60,
  vendor:       8 * 60 * 60,
  rider:       12 * 60 * 60,
  admin:        4 * 60 * 60,
  super_admin:  2 * 60 * 60,
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const expiresIn = SESSION_DURATIONS[payload.role]
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(getJwtSecret())
}
