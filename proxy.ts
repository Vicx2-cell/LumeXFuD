import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from './lib/auth'

const PROTECTED: Array<{ pattern: RegExp; roles: string[] }> = [
  { pattern: /^\/vendor-dashboard(\/|$)/, roles: ['vendor', 'admin', 'super_admin'] },
  { pattern: /^\/rider(\/|$)/,            roles: ['rider', 'admin', 'super_admin'] },
  { pattern: /^\/admin(\/|$)/,            roles: ['admin', 'super_admin'] },
  { pattern: /^\/super-admin(\/|$)/,      roles: ['super_admin'] },
  { pattern: /^\/orders(\/|$)/,           roles: ['customer', 'vendor', 'rider', 'admin', 'super_admin'] },
  { pattern: /^\/profile(\/|$)/,          roles: ['customer', 'vendor', 'rider', 'admin', 'super_admin'] },
]

const ROLE_HOME: Record<string, string> = {
  vendor:      '/vendor-dashboard',
  rider:       '/rider/dashboard',
  admin:       '/admin',
  super_admin: '/super-admin',
  customer:    '/',
}

// Next.js 16: function must be named "proxy" (renamed from "middleware")
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const guard = PROTECTED.find((p) => p.pattern.test(pathname))

  if (!guard) return NextResponse.next()

  const token = req.cookies.get('session')?.value
  if (!token) {
    const loginUrl = new URL('/auth', req.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const session = await verifySessionToken(token)
  if (!session) {
    const loginUrl = new URL('/auth', req.url)
    loginUrl.searchParams.set('next', pathname)
    const res = NextResponse.redirect(loginUrl)
    res.cookies.delete('session')
    return res
  }

  if (!guard.roles.includes(session.role)) {
    return NextResponse.redirect(new URL(ROLE_HOME[session.role] ?? '/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  // CRITICAL: explicit matcher prevents CVE-2026-44575 (.rsc segment bypass)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/paystack/webhook|icons|manifest.json|sw.js).*)',
  ],
}
