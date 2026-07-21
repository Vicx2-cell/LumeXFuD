import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { retryEmailEvent } from '@/lib/email/retry-email-event'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createSupabaseAdmin()
  const [{ data: deliveries }, { data: cases }] = await Promise.all([
    db.from('email_operations_admin').select('*').order('created_at', { ascending: false }).limit(100),
    db.from('contact_cases').select('id, reference_number, intent, status, owner_queue, acknowledgement_status, escalation_due_at, created_at').order('created_at', { ascending: false }).limit(100),
  ])
  return NextResponse.json({ deliveries: deliveries ?? [], cases: cases ?? [] })
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const limit = await rateLimitGeneric(`email-retry:${session.userId ?? session.phone}`, 10, 60, true)
  if (!limit.success) return NextResponse.json({ error: 'Too many retry requests.' }, { status: 429 })
  const parsed = z.object({ eventId: z.string().uuid() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid event.' }, { status: 400 })
  const result = await retryEmailEvent(createSupabaseAdmin(), parsed.data.eventId)
  return NextResponse.json({ result })
}
