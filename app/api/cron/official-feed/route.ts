import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret, withCronHealth } from '@/lib/cron-health'
import { runOfficialFeedScheduler } from '@/lib/feed/official-scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handler(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runOfficialFeedScheduler()
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  return withCronHealth('official-feed', () => handler(req))
}
