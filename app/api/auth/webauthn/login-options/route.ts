import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import {
  getRpID, signChallenge, verifyMfaPending,
  WA_CHALLENGE_COOKIE, MFA_COOKIE, shortCookie,
} from '@/lib/webauthn'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Step 2 of login. Only reachable after a correct PIN, which set the signed
// mfa_pending cookie. We trust the identity from that cookie — never the body.
export async function POST(req: NextRequest) {
  const mfa = await verifyMfaPending(req.cookies.get(MFA_COOKIE)?.value)
  if (!mfa) {
    return NextResponse.json({ error: 'Enter your PIN first' }, { status: 401 })
  }

  // Cap challenge issuance at 10 / 15 min per PIN-verified user.
  const rl = await rateLimitGeneric(`webauthn-loginoptions:${mfa.userId}`, 10, 900)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Please wait and try again.' }, { status: 429 })
  }

  const db = createSupabaseAdmin()
  const { data: creds } = await db
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', mfa.userId)
    .eq('user_role', mfa.role)

  if (!creds || creds.length === 0) {
    return NextResponse.json({ error: 'No Face ID set up on this account' }, { status: 400 })
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpID(),
    allowCredentials: creds.map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    userVerification: 'required',
  })

  const challengeToken = await signChallenge({
    type: 'auth',
    challenge: options.challenge,
    phone: mfa.phone,
    userId: mfa.userId,
    role: mfa.role,
  })

  const res = NextResponse.json(options)
  res.cookies.set(WA_CHALLENGE_COOKIE, challengeToken, shortCookie())
  return res
}
