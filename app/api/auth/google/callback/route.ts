import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createSession, setCookieOptions, type SessionRole } from '@/lib/session'
import { getRoleRedirect } from '@/lib/pin-auth'
import { getFeature } from '@/lib/features'
import {
  exchangeCodeForIdentity,
  verifyState,
  signSocialPending,
  GOOGLE_STATE_COOKIE,
  SOCIAL_PENDING_COOKIE,
  shortCookieOptions,
} from '@/lib/google-oauth'

// Append an in-app `next` to a path without trusting external input.
function withNext(path: string, next: string): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && next !== '/') {
    return `${path}?next=${encodeURIComponent(next)}`
  }
  return path
}

// GET /api/auth/google/callback?code=...&state=...
// Google sends the user back here. Verify everything, then either log an
// existing customer straight in, or hand a verified identity to the phone-
// collection step for brand-new users.
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const err = (slug: string) => NextResponse.redirect(new URL(`/auth?error=${slug}`, req.url))

  if (!(await getFeature('google_login'))) return err('google_disabled')

  // Google reports its own errors (e.g. the user hit "cancel") via ?error=.
  if (url.searchParams.get('error')) return err('google_cancelled')

  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state') ?? undefined
  const stateCookie = req.cookies.get(GOOGLE_STATE_COOKIE)?.value

  // CSRF: the state in the URL must match the one we set as a cookie AND verify
  // as a token we signed. Either missing/mismatched → reject.
  if (!code || !stateParam || !stateCookie || stateParam !== stateCookie) {
    return err('google_state')
  }
  const verified = await verifyState(stateParam)
  if (!verified) return err('google_state')
  const next = verified.next

  let identity
  try {
    identity = await exchangeCodeForIdentity(code)
  } catch {
    return err('google_failed')
  }

  // Google requires the email to be verified before we trust it for matching.
  if (!identity.emailVerified) {
    return err('google_unverified_email')
  }

  const db = createSupabaseAdmin()

  // ── Returning user? Match on the stable `sub` first, then the email. ──
  const { data: bySub } = await db
    .from('customers')
    .select('id, phone, suspended_until, suspend_reason')
    .eq('google_sub', identity.sub)
    .is('deleted_at', null)
    .maybeSingle()

  type CustomerRow = {
    id: string
    phone: string
    google_sub?: string | null
    suspended_until?: string | null
    suspend_reason?: string | null
  }

  let existing = bySub as CustomerRow | null

  if (!existing && identity.email) {
    const { data: byEmail } = await db
      .from('customers')
      .select('id, phone, google_sub, suspended_until, suspend_reason')
      .ilike('email', identity.email)
      .is('deleted_at', null)
      .maybeSingle()
    const emailRow = byEmail as CustomerRow | null
    if (emailRow) {
      existing = emailRow
      // First Google sign-in for an account that previously only had an email
      // on file → link the stable sub so future logins match on it directly.
      if (!emailRow.google_sub) {
        await db.from('customers').update({ google_sub: identity.sub }).eq('id', emailRow.id)
      }
    }
  }

  if (existing) {
    if (existing.suspended_until && new Date(existing.suspended_until).getTime() > Date.now()) {
      return err('account_suspended')
    }
    // Customer role only (Google is a customer-facing front door). The super
    // admin uses phone + PIN, not Google.
    const role: SessionRole = 'customer'
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    const userAgent = req.headers.get('user-agent') ?? undefined
    const { token } = await createSession(existing.id, existing.phone, role, ipAddress, userAgent)

    const dest = next !== '/' ? next : getRoleRedirect(role)
    const res = NextResponse.redirect(new URL(dest, req.url))
    res.cookies.set('session', token, setCookieOptions(role))
    res.cookies.set(GOOGLE_STATE_COOKIE, '', shortCookieOptions(0))
    return res
  }

  // ── New user → must still give us a phone (same data as a phone sign-up). ──
  // Gate it behind the signups switch here, so existing users can always log in
  // even when new sign-ups are paused.
  if (!(await getFeature('signups'))) return err('signups_closed')

  const pending = await signSocialPending({
    provider: 'google',
    sub: identity.sub,
    email: identity.email,
    emailVerified: identity.emailVerified,
    name: identity.name,
  })

  const res = NextResponse.redirect(new URL(withNext('/auth/complete', next), req.url))
  res.cookies.set(SOCIAL_PENDING_COOKIE, pending, shortCookieOptions(20 * 60))
  res.cookies.set(GOOGLE_STATE_COOKIE, '', shortCookieOptions(0))
  return res
}
