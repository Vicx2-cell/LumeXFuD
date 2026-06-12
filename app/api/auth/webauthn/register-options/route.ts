import { NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { RP_NAME, getRpID, signChallenge, WA_CHALLENGE_COOKIE, shortCookie } from '@/lib/webauthn'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Generate registration options for the logged-in (PIN-verified) user to enrol a
// Face ID / Touch ID passkey. Must be authenticated — you can only add a second
// factor to your own account.
export async function POST() {
  const session = await getCurrentUser()
  if (!session || !session.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rl = await rateLimitGeneric(`webauthn-regoptions:${session.userId}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', session.userId)
    .eq('user_role', session.role)

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(),
    userName: session.phone,
    userDisplayName: session.name ?? session.phone,
    userID: new TextEncoder().encode(session.userId),
    attestationType: 'none',
    // Don't let the same authenticator enrol twice.
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      // Force an actual biometric / device PIN, not mere presence.
      userVerification: 'required',
    },
  })

  const challengeToken = await signChallenge({
    type: 'reg',
    challenge: options.challenge,
    phone: session.phone,
    userId: session.userId,
    role: session.role,
  })

  const res = NextResponse.json(options)
  res.cookies.set(WA_CHALLENGE_COOKIE, challengeToken, shortCookie())
  return res
}
