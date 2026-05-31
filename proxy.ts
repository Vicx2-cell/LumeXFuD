import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from './lib/session'
import { createSupabaseAdmin } from './lib/supabase/server'

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

// ─── Content-Security-Policy (per-request nonce) ──────────────────────────────
// A static header cannot carry a per-request nonce, so the CSP is built here.
// 'strict-dynamic' lets scripts loaded by our nonced scripts (e.g. Paystack's
// own dynamically-injected scripts) run, while https://js.paystack.co remains a
// fallback for browsers that ignore strict-dynamic. The nonce is exposed to the
// app via the x-nonce request header so <Script nonce={...}> can read it.
function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production'
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' https://js.paystack.co`
    : `'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co`
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co https://api.paystack.co https://api.ng.termii.com",
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

  // Per-request CSP nonce. Global Web Crypto + btoa are available on the
  // Edge runtime (no Node imports needed here).
  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce)

  // Forward the nonce to the app so server components / <Script> can use it.
  // Next.js also reads the nonce from the CSP on the *request* headers to
  // auto-apply it to its own framework <script> tags — so set it on both.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  // Attaches the CSP to any response we return.
  const withCsp = (res: NextResponse): NextResponse => {
    res.headers.set('Content-Security-Policy', csp)
    return res
  }
  const next = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  const redirect = (url: URL) => withCsp(NextResponse.redirect(url))

  // /auth/setup is always accessible to authenticated users — don't intercept
  if (pathname.startsWith('/auth')) return next()

  const token = req.cookies.get('session')?.value

  if (token) {
    const session = await verifySessionToken(token)

    if (session) {
      // Redirect away from the public landing page and auth entry points
      if (LANDING_ROUTES.has(pathname)) {
        return redirect(new URL(ROLE_HOME[session.role] ?? '/home', req.url))
      }

      const guard = PROTECTED.find((p) => p.pattern.test(pathname))

      if (guard) {
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
    res.cookies.delete('session')
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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/paystack/webhook|icons|manifest.json|sw.js).*)',
  ],
}
