import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose'

// ── Google "Continue with Google" sign-in ──────────────────────────────────
// A confidential (server-side) OAuth 2.0 / OpenID Connect client. Flow:
//   1. /api/auth/google/start  → redirect the browser to Google with a signed
//      `state` (CSRF token, also carries the post-login `next` path).
//   2. Google redirects back to /api/auth/google/callback with `code` + `state`.
//   3. We verify `state`, exchange `code` for tokens, then verify the id_token's
//      signature against Google's JWKS and read the user's stable `sub` + email.
//
// No new dependency: `jose` (already used for our session JWTs) handles both the
// HS256 state/pending tokens and the RS256 Google id_token verification.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export const GOOGLE_STATE_COOKIE = 'g_oauth_state'
export const SOCIAL_PENDING_COOKIE = 'social_pending'

function jwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET not set')
  return new TextEncoder().encode(s)
}

/** Throws (with a clear message) if Google OAuth isn't configured. */
export function getGoogleConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured')
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL not set')
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, '')}/api/auth/google/callback`,
  }
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
}

// ── State token (CSRF) ──────────────────────────────────────────────────────
// Signed, short-lived. Stored both as the OAuth `state` param and an httpOnly
// cookie; the callback requires both to be present, identical, and valid.

export async function signState(next: string): Promise<string> {
  return new SignJWT({ stage: 'g_state', next })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(jwtSecret())
}

export async function verifyState(token: string | undefined): Promise<{ next: string } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] })
    if (payload.stage !== 'g_state') return null
    const next = typeof payload.next === 'string' ? payload.next : '/'
    return { next }
  } catch {
    return null
  }
}

export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the account chooser; never silently reuse a stale Google login.
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export interface GoogleIdentity {
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

/** Exchange the authorization code for tokens and return the verified identity. */
export async function exchangeCodeForIdentity(code: string): Promise<GoogleIdentity> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig()

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error('Google token exchange failed')
  const tokens = (await res.json()) as { id_token?: string }
  if (!tokens.id_token) throw new Error('Google did not return an id_token')

  // Verify the id_token's RS256 signature against Google's published keys, and
  // pin issuer + audience so a token minted for another app can't be replayed.
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
  })

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) throw new Error('Google id_token missing sub')
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : null,
  }
}

// ── Social-pending token ──────────────────────────────────────────────────
// Issued when a verified Google identity has NO matching account yet. Carries
// the proven identity through the "add your phone" completion step. Short-lived
// and httpOnly — the completion route trusts it instead of re-running OAuth.

export interface SocialPending {
  provider: 'google'
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

export async function signSocialPending(p: SocialPending): Promise<string> {
  return new SignJWT({ stage: 'social_pending', ...p })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('20m')
    .sign(jwtSecret())
}

export async function verifySocialPending(token: string | undefined): Promise<SocialPending | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] })
    if (payload.stage !== 'social_pending' || payload.provider !== 'google') return null
    if (typeof payload.sub !== 'string') return null
    return {
      provider: 'google',
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.emailVerified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
    }
  } catch {
    return null
  }
}

/** httpOnly cookie options. `lax` so the cookie survives Google's top-level
 *  redirect back to our callback (a cross-site → same-site GET navigation). */
export function shortCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: maxAgeSeconds,
    path: '/',
  }
}
