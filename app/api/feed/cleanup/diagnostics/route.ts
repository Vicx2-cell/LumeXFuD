import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { cleanupVideoMedia } from '@/lib/feed/lifecycle'

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const dryRun = req.nextUrl.searchParams.get('dry_run') !== 'false'
  try {
    const result = await cleanupVideoMedia(dryRun)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not run diagnostics' }, { status: 400 })
  }
}

