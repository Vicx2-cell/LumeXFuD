import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret, withCronHealth } from '@/lib/cron-health'
import { runOfficialFeedScheduler } from '@/lib/feed/official-scheduler'
import { loadFeedAutomationConfig, runFeedAutomationWorker } from '@/lib/feed/automation-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handler(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const config = await loadFeedAutomationConfig()
  if (!config.enabled) {
    return NextResponse.json({ paused: true, reason: 'feed automation kill switch is off' })
  }
  const [official, marketplace] = await Promise.all([
    runOfficialFeedScheduler(),
    runFeedAutomationWorker(),
  ])
  return NextResponse.json({ official, marketplace })
}

export async function GET(req: NextRequest) {
  return withCronHealth('official-feed', () => handler(req))
}
