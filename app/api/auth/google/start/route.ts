import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import {
  buildAuthUrl,
  signState,
  isGoogleConfigured,
  GOOGLE_STATE_COOKIE,
  shortCookieOptions,
} from '@/lib/google-oauth'

// GET /api/auth/google/start?next=/somewhere
// Kicks off the OAuth dance: sign a CSRF `state` (carrying the post-login
// destination), drop it as an httpOnly cookie, and 302 the browser to Google.
export async function GET(req: NextRequest) {
  if (!(await getFeature('google_login'))) {
    return NextResponse.redirect(new URL('/auth?error=google_disabled', req.url))
  }
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL('/auth?error=google_unavailable', req.url))
  }

  // Only honour in-app destinations (no open-redirects).
  const raw = req.nextUrl.searchParams.get('next')
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'

  const state = await signState(next)
  const res = NextResponse.redirect(buildAuthUrl(state))
  res.cookies.set(GOOGLE_STATE_COOKIE, state, shortCookieOptions(600))
  return res
}
