import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, isSessionLive } from './lib/session'
import { createSupabaseAdmin } from './lib/supabase/server'
import { sessionCookieName } from './lib/session-cookie'
import { recordSecurityEvent } from './lib/security-events'

const PROTECTED: Array<{ pattern: RegExp; roles: string[] }> = [
  { pattern: /^\/home(\/|$)/,          roles: ['customer', 'admin', 'super_admin'] },
  { pattern: /^\/vendor-dashboard(\/|$)/, roles: ['vendor', 'admin', 'super_admin'] },
  { pattern: /^\/rider(\/|$)/,          roles: ['rider', 'admin', 'super_admin'] },
  { pattern: /^\/admin(\/|$)/,          roles: ['admin', 'super_admin'] },
  { pattern: /^\/super-admin(\/|$)/,    roles: ['super_admin'] },
  { pattern: /^\/orders(\/|$)/,         roles: ['customer', 'vendor', 'rider', 'admin', 'super_admin'] },
  { pattern: /^\/profile(\/|$)/,        roles: ['customer', 'vendor', 'rider', 'admin', 'super_admin'] },
  { pattern: /^\/cart(\/|$)/,           roles: ['customer', 'admin', 'super_admin'] },
]

const ROLE_HOME: Record<string, string> = {
  customer:    '/home',
  vendor:      '/vendor-dashboard',
  rider:       '/rider',
  admin:       '/admin',
  super_admin: '/super-admin',
}

const ROLE_TABLE: Record<string, string> = {
  customer: 'customers', vendor: 'vendors', rider: 'riders',
  admin: 'admins', super_admin: 'admins',
}

// Public routes that logged-in users should be redirected away from
const LANDING_ROUTES = new Set(['/', '/auth/register', '/auth/forgot-pin'])

// Exploit-scanner probe paths — never legitimate here. Matched anywhere in the
// path so nested probes (e.g. /foo/.git/config) are caught too.
const SCANNER_RE =
  /(?:^|\/)(?:\.env|\.git|\.aws|\.ssh|\.svn|\.hg|wp-login\.php|wp-admin|xmlrpc\.php|phpmyadmin|vendor\/phpunit|config\.php|\.htaccess|\.DS_Store|id_rsa|\.well-known\/[^/]*\.php)(?:$|\/|\.)/i

// ─── Content-Security-Policy ──────────────────────────────────────────────────
// NOTE: nonce + 'strict-dynamic' was tried and BROKE production. Next.js only
// injects the per-request nonce into its <script> tags when a route is
// *dynamically* rendered; statically-prerendered pages (most of this app) ship
// their framework chunks and inline bootstrap scripts WITHOUT a nonce. With
// 'strict-dynamic' present, browsers ignore 'self', so every un-nonced
// /_next/static chunk and inline script was blocked and the app loaded zero
// client JS (no cart, no checkout, no login). See scripts/live-flow.mjs.
//
// Fix: drop 'strict-dynamic'/nonce from script-src so 'self' covers same-origin
// chunks and 'unsafe-inline' covers Next's inline scripts. The nonce is still
// generated and forwarded as x-nonce for any future dynamic <Script nonce>.
// Hardening follow-up: move security-sensitive routes to dynamic rendering and
// restore nonce+strict-dynamic there. XSS risk is mitigated by React escaping,
// no dangerouslySetInnerHTML in audited paths, and lib/security sanitize().
function buildCsp(_nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production'
  const scriptSrc = isProd
    ? `'self' 'unsafe-inline' https://js.paystack.co`
    : `'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co`
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // OSM tiles are loaded as <img> by Leaflet (the campus lodge map).
    "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org",
    // Story/feed videos use blob: while previewing and Supabase after upload.
    "media-src 'self' blob: https://*.supabase.co",
    // wss://*.supabase.co is REQUIRED for Supabase Realtime (live vendor status
    // on /home, leaderboard). Without it the socket is CSP-blocked and retries in
    // a loop, which can destabilise iOS Safari ("page couldn't load").
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.paystack.co https://api.sendchamp.com",
    "frame-src https://js.paystack.co",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

async function hasPinResetPending(phone: string, role: string): Promise<boolean> {
  try {
    const table = ROLE_TABLE[role]
    if (!table) return false
    const db = createSupabaseAdmin()
    const { data } = await db.from(table).select('pin_reset_pending').eq('phone', phone).maybeSingle()
    return (data as { pin_reset_pending?: boolean } | null)?.pin_reset_pending === true
  } catch {
    return false
  }
}

// Next.js 16: function must be named "proxy" (renamed from "middleware")
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ─── Edge exploit-scanner firewall ──────────────────────────────────────────
  // Instantly 404 automated probes for paths that are NEVER legitimate on this
  // app (env files, VCS dirs, secrets, and other stacks' admin panels). Stops the
  // noisy bot floods that hammer every public site before they reach app code,
  // and never reveals that the path was "blocked". Real routes are unaffected.
  if (SCANNER_RE.test(pathname)) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Per-request CSP nonce. Global Web Crypto + btoa are available on the
  // Edge runtime (no Node imports needed here).
  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce)

  // Forward the nonce to the app so server components / <Script> can use it.
  // NOTE: we deliberately do NOT set Content-Security-Policy on the *request*
  // headers. Doing so makes Next.js run its CSP/nonce-aware path on every
  // dynamically-rendered page — and since our CSP carries no nonce, that path
  // added nothing but appeared to crash iOS Safari on dynamic pages (/home,
  // /orders) while statically-prerendered pages (landing) were fine. The CSP is
  // still enforced via the response header below; security is unchanged.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)

  // Attaches the CSP to any response we return.
  const withCsp = (res: NextResponse): NextResponse => {
    res.headers.set('Content-Security-Policy', csp)
    return res
  }
  const next = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  const redirect = (url: URL) => withCsp(NextResponse.redirect(url))

  // /auth/setup is always accessible to authenticated users — don't intercept
  if (pathname.startsWith('/auth')) return next()

  const token = req.cookies.get(sessionCookieName())?.value

  if (token) {
    const session = await verifySessionToken(token)

    if (session) {
      // Enforce server-side revocation/expiry at the EDGE too — not only in
      // getCurrentUser. Without this, a revoked or re-keyed token keeps loading
      // protected pages until its JWT exp. FAIL CLOSED: isSessionLive returns
      // false on ANY DB error/timeout, so an unconfirmable session is treated as
      // dead — clear the cookie, send to /auth, and log the attempt.
      if (!(await isSessionLive(session.sessionId))) {
        await recordSecurityEvent({
          eventType: 'auth_fail', severity: 'warn', surface: 'jwt',
          actorId: session.userId, actorRole: session.role, sessionId: session.sessionId,
          ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
          userAgent: req.headers.get('user-agent') ?? undefined,
          detail: { reason: 'revoked_or_expired_token_at_edge', path: pathname },
        })
        const loginUrl = new URL('/auth', req.url)
        loginUrl.searchParams.set('next', pathname)
        const res = redirect(loginUrl)
        res.cookies.delete(sessionCookieName())
        return res
      }

      // Redirect away from the public landing page and auth entry points
      if (LANDING_ROUTES.has(pathname)) {
        return redirect(new URL(ROLE_HOME[session.role] ?? '/home', req.url))
      }

      const guard = PROTECTED.find((p) => p.pattern.test(pathname))

      if (guard) {
        // PANIC lockdown: every role except super_admin is locked out of all
        // protected pages. Send them to /auth (login refuses non-super while
        // locked). Fail-open — a controls read error must never lock anyone out.
        if (session.role !== 'super_admin') {
          try {
            const { isLockedDown } = await import('./lib/controls')
            if (await isLockedDown()) {
              const lockedUrl = new URL('/auth', req.url)
              lockedUrl.searchParams.set('locked', '1')
              return redirect(lockedUrl)
            }
          } catch { /* controls unreadable — do not lock out */ }
        }

        // Redirect to setup if account PIN setup is incomplete
        const pending = await hasPinResetPending(session.phone, session.role)
        if (pending) return redirect(new URL('/auth/setup', req.url))

        // Wrong role for this route — send to their home
        if (!guard.roles.includes(session.role)) {
          return redirect(new URL(ROLE_HOME[session.role] ?? '/home', req.url))
        }
      }

      return next()
    }

    // Invalid/expired token — clear it
    const loginUrl = new URL('/auth', req.url)
    loginUrl.searchParams.set('next', pathname)
    const res = redirect(loginUrl)
    res.cookies.delete(sessionCookieName())
    return res
  }

  // No token — block protected routes
  const guard = PROTECTED.find((p) => p.pattern.test(pathname))
  if (guard) {
    const loginUrl = new URL('/auth', req.url)
    loginUrl.searchParams.set('next', pathname)
    return redirect(loginUrl)
  }

  return next()
}

export const config = {
  // CRITICAL: explicit matcher prevents CVE-2026-44575 (.rsc segment bypass)
  //
  // `api` is excluded wholesale: API routes authenticate themselves with
  // getCurrentUser() and must ALWAYS return their own JSON. If the proxy runs on
  // them, a request carrying a stale/expired `session` cookie hits the invalid-
  // token branch and gets 307-redirected to /auth (an HTML page) — the client's
  // res.json() then throws and surfaces as a bogus "Connection error" on login.
  // CSP only matters for document responses, so dropping it on /api is harmless.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|icons|manifest.json|sw.js).*)',
  ],
}
