import { NextRequest, NextResponse } from 'next/server'

// TikTok OAuth callback placeholder.
// The portal needs a stable HTTPS redirect URI on our domain.
// When TikTok login is wired up, this route can be expanded to exchange the code.
export async function GET(req: NextRequest) {
  const url = new URL('/auth?error=tiktok_not_configured', req.url)
  return NextResponse.redirect(url)
}

// TikTok's URL test can hit the callback with POST, so respond 200 instead of 405.
export async function POST() {
  return NextResponse.json({ ok: true })
}
