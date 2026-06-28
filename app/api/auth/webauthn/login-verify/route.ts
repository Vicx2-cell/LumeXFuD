import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { recordSecurityEvent } from '@/lib/security-events'
import { getRoleRedirect } from '@/lib/pin-auth'
import { decryptField } from '@/lib/crypto'
import {
  getExpectedOrigin, getRpID, verifyChallenge, verifyMfaPending,
  WA_CHALLENGE_COOKIE, MFA_COOKIE, clearCookie,
} from '@/lib/webauthn'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // Both gates must hold: PIN passed (mfa) AND a matching auth challenge.
  const mfa = await verifyMfaPending(req.cookies.get(MFA_COOKIE)?.value)
  if (!mfa) return NextResponse.json({ error: 'Enter your PIN first' }, { status: 401 })

  // Brute-force guard on the second factor — cap at 10 / 15 min per PIN-verified
  // user (the identity comes from the signed mfa cookie, never the body).
  const rl = await rateLimitGeneric(`webauthn-loginverify:${mfa.userId}`, 10, 900)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
  }

  const ch = await verifyChallenge(req.cookies.get(WA_CHALLENGE_COOKIE)?.value)
  if (!ch || ch.type !== 'auth' || ch.userId !== mfa.userId) {
    return NextResponse.json({ error: 'Face ID session expired. Try again.' }, { status: 400 })
  }

  let body: AuthenticationResponseJSON
  try {
    body = (await req.json()) as AuthenticationResponseJSON
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  // Bind the credential to the PIN-verified user — a passkey enrolled to another
  // account cannot be used to satisfy this user's second factor.
  const { data: cred } = await db
    .from('webauthn_credentials')
    .select('id, credential_id, public_key, counter, transports')
    .eq('credential_id', body.id)
    .eq('user_id', mfa.userId)
    .eq('user_role', mfa.role)
    .maybeSingle()

  if (!cred) {
    return NextResponse.json({ error: 'Unknown device' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: ch.challenge,
      expectedOrigin: getExpectedOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: true,
      credential: {
        id: cred.credential_id as string,
        publicKey: isoBase64URL.toBuffer(decryptField(cred.public_key as string)),
        counter: Number(cred.counter),
        transports: (cred.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
      },
    })
  } catch (e) {
    console.error('[webauthn/login-verify]', e)
    return NextResponse.json({ error: 'Could not verify Face ID' }, { status: 400 })
  }

  if (!verification.verified) {
    await recordSecurityEvent({
      eventType: 'stepup_fail', severity: 'warn', surface: 'webauthn',
      actorId: mfa.userId, actorRole: mfa.role,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      detail: { reason: 'assertion_not_verified' },
    })
    return NextResponse.json({ error: 'Face ID verification failed' }, { status: 400 })
  }

  // Persist the new signature counter (clone-detection: SimpleWebAuthn rejects
  // a counter that regresses) and stamp last use.
  await db.from('webauthn_credentials')
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq('id', cred.id)

  // Both factors satisfied → issue the real session now.
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
  const userAgent = req.headers.get('user-agent') ?? undefined
  const { token } = await createSession(mfa.userId, mfa.phone, mfa.role, ipAddress, userAgent)

  const res = NextResponse.json({ role: mfa.role, redirect_path: getRoleRedirect(mfa.role) })
  res.cookies.set(sessionCookieName(), token, setCookieOptions(mfa.role))
  // Burn the step-up cookies — single use.
  res.cookies.set(MFA_COOKIE, '', clearCookie())
  res.cookies.set(WA_CHALLENGE_COOKIE, '', clearCookie())
  return res
}
