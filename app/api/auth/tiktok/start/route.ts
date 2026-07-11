import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/vendor-dashboard/videos'

  if (!(await getFeature('tiktok_connection_enabled'))) {
    return NextResponse.redirect(new URL(`${safeNext}?connect=tiktok&status=disabled`, req.url))
  }

  // OAuth implementation is intentionally gated behind provider config. Until
  // credentials are provisioned, this route gives the user a clear destination
  // instead of a blank or broken page.
  return NextResponse.redirect(new URL(`${safeNext}?connect=tiktok&status=not_configured`, req.url))
}
