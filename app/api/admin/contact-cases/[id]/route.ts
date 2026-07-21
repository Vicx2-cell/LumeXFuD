import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { renderCaseUpdate } from '@/lib/email/templates'
import { deliverWorkflowEmail } from '@/lib/email/workflow-email'

const inputSchema = z.object({
  status: z.enum(['reviewing', 'awaiting_user', 'resolved', 'rejected', 'escalated']),
  publicMessage: z.string().trim().min(5).max(1000),
  outcome: z.string().trim().max(1000).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const limit = await rateLimitGeneric(`contact-case-update:${session.userId ?? session.phone}`, 20, 60)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid case update.' }, { status: 400 })
  const { id } = await params
  const db = createSupabaseAdmin()
  const { data: record } = await db.from('contact_cases').select('id, reference_number, requester_name, requester_email, intent, status').eq('id', id).maybeSingle()
  if (!record) return NextResponse.json({ error: 'Case not found.' }, { status: 404 })
  const now = new Date().toISOString()
  await db.from('contact_cases').update({ status: parsed.data.status, outcome: parsed.data.outcome ?? null, resolved_at: ['resolved', 'rejected'].includes(parsed.data.status) ? now : null, updated_at: now }).eq('id', id)

  const workflow = record.intent === 'security' || record.intent === 'fraud'
    ? 'security_case_update'
    : parsed.data.status === 'awaiting_user' ? 'additional_information_request'
      : parsed.data.status === 'resolved' ? 'case_resolution'
        : ['support', 'complaint', 'refund'].includes(record.intent) ? 'issue_status_update' : null
  let notificationStatus = 'manual_required'
  if (workflow) {
    const template = renderCaseUpdate({ workflow, name: record.requester_name, reference: record.reference_number, status: parsed.data.status, publicMessage: parsed.data.publicMessage, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/contact` })
    const delivery = await deliverWorkflowEmail(db, { eventKey: `case-update:${id}:${record.status}-to-${parsed.data.status}`, eventKind: 'CASE_UPDATE', workflow, recipient: record.requester_email, initiatedBy: 'admin', ...template })
    notificationStatus = delivery.status
    if (delivery.status === 'sent') await db.from('contact_cases').update({ last_notified_at: now }).eq('id', id)
  }
  return NextResponse.json({ success: true, status: parsed.data.status, notificationStatus })
}
