import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const token = req.cookies.get(sessionCookieName())?.value

  if (token) {
    const payload = await verifySessionToken(token)
    if (payload?.sessionId) {
      const db = createSupabaseAdmin()
      await db
        .from('sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', payload.sessionId)
    }
  }

  const res = NextResponse.json({ success: true }, { status: 200 })
  res.cookies.set(sessionCookieName(), '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  return res
}
