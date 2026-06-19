import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { getCronHealth } from '@/lib/cron-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/super-admin/cron-health — super-admin only. Returns every cron's last
// heartbeat + overdue state so a silently-dead cron is visible before it strands
// money. Read-only.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const jobs = await getCronHealth()
  return NextResponse.json({ jobs, now: new Date().toISOString() })
}
