import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { encryptField } from '@/lib/crypto'
import {
  getExpectedOrigin, getRpID, verifyChallenge,
  WA_CHALLENGE_COOKIE, clearCookie,
} from '@/lib/webauthn'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || !session.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rl = await rateLimitGeneric(`webauthn-regverify:${session.userId}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const ch = await verifyChallenge(req.cookies.get(WA_CHALLENGE_COOKIE)?.value)
  // Challenge must exist, be a registration challenge, and belong to THIS user.
  if (!ch || ch.type !== 'reg' || ch.userId !== session.userId) {
    return NextResponse.json({ error: 'Registration session expired. Try again.' }, { status: 400 })
  }

  let body: RegistrationResponseJSON
  try {
    body = (await req.json()) as RegistrationResponseJSON
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: ch.challenge,
      expectedOrigin: getExpectedOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: true,
    })
  } catch (e) {
    console.error('[webauthn/register-verify]', e)
    return NextResponse.json({ error: 'Could not verify device' }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
  }

  const { credential } = verification.registrationInfo
  const db = createSupabaseAdmin()
  const { error } = await db.from('webauthn_credentials').insert({
    user_id: session.userId,
    user_role: session.role,
    phone: session.phone,
    credential_id: credential.id,
    // Public key encrypted at rest (also gives tamper-detection on the value
    // the server trusts when verifying future assertions).
    public_key: encryptField(isoBase64URL.fromBuffer(credential.publicKey)),
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_label: 'Face ID / Touch ID',
  })

  if (error) {
    // Unique violation ⇒ this authenticator is already enrolled.
    const already = error.code === '23505'
    return NextResponse.json(
      { error: already ? 'This device is already set up' : 'Could not save credential' },
      { status: already ? 409 : 500 },
    )
  }

  const res = NextResponse.json({ verified: true })
  res.cookies.set(WA_CHALLENGE_COOKIE, '', clearCookie())
  return res
}
