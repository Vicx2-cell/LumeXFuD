import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { renderCaseAcknowledgement } from '@/lib/email/templates'
import { deliverWorkflowEmail } from '@/lib/email/workflow-email'
import type { EmailWorkflow } from '@/lib/email/identities'

const intentSchema = z.enum(['general', 'support', 'complaint', 'refund', 'partnership', 'sponsorship', 'security', 'fraud', 'press', 'privacy', 'deletion', 'legal'])
const inputSchema = z.object({
  intent: intentSchema,
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(4).max(140).refine((value) => !/[\r\n]/.test(value)),
  message: z.string().trim().min(20).max(5000),
  relatedReference: z.string().trim().max(80).optional(),
  website: z.string().max(0).optional(),
})

const routing: Record<z.infer<typeof intentSchema>, { queue: string; workflow: EmailWorkflow; prefix: string }> = {
  general: { queue: 'general', workflow: 'general_contact_acknowledgement', prefix: 'GEN' },
  support: { queue: 'support', workflow: 'support_acknowledgement', prefix: 'SUP' },
  complaint: { queue: 'support', workflow: 'complaint_received', prefix: 'CMP' },
  refund: { queue: 'support', workflow: 'support_acknowledgement', prefix: 'REF' },
  partnership: { queue: 'partnerships', workflow: 'partnership_acknowledgement', prefix: 'PAR' },
  sponsorship: { queue: 'partnerships', workflow: 'sponsorship_acknowledgement', prefix: 'SPN' },
  security: { queue: 'security', workflow: 'security_report_acknowledgement', prefix: 'SEC' },
  fraud: { queue: 'security', workflow: 'fraud_report_acknowledgement', prefix: 'FRD' },
  press: { queue: 'press', workflow: 'press_acknowledgement', prefix: 'PRS' },
  privacy: { queue: 'legal', workflow: 'privacy_request_acknowledgement', prefix: 'PRV' },
  deletion: { queue: 'legal', workflow: 'deletion_request_acknowledgement', prefix: 'DEL' },
  legal: { queue: 'legal', workflow: 'legal_notice_acknowledgement', prefix: 'LEG' },
}

function baseUrl(): string {
  try { return new URL(process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng').origin } catch { return 'https://lumexfud.com.ng' }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = await rateLimitGeneric(`contact:${ip}`, 5, 3600, true)
  if (!limit.success) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) }
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the form details.' }, { status: 400 })

  const value = parsed.data
  const route = routing[value.intent]
  const email = value.email.toLowerCase()
  const day = new Date().toISOString().slice(0, 10)
  const submissionHash = createHash('sha256').update(`${day}|${value.intent}|${email}|${value.subject.toLowerCase()}|${value.message.toLowerCase()}`).digest('hex')
  const reference = `LXF-${route.prefix}-${day.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`
  const db = createSupabaseAdmin()
  const { data: created, error } = await db.from('contact_cases').insert({
    reference_number: reference, intent: value.intent, requester_name: value.name, requester_email: email,
    subject: value.subject, message: value.message, related_reference: value.relatedReference || null,
    owner_queue: route.queue, submission_hash: submissionHash,
    escalation_due_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  }).select('id, reference_number, acknowledgement_status').single()

  if (error?.code === '23505') {
    const { data: duplicate } = await db.from('contact_cases').select('id, reference_number, acknowledgement_status').eq('submission_hash', submissionHash).maybeSingle()
    if (duplicate) return NextResponse.json({ success: true, duplicate: true, reference: duplicate.reference_number, acknowledgementStatus: duplicate.acknowledgement_status })
  }
  if (error || !created) return NextResponse.json({ error: 'We could not save your request. Nothing was sent; please try again.' }, { status: 500 })

  const template = renderCaseAcknowledgement({ workflow: route.workflow, name: value.name, reference, actionUrl: `${baseUrl()}/contact` })
  const delivery = await deliverWorkflowEmail(db, { eventKey: `contact-ack:${created.id}`, eventKind: 'CONTACT_ACKNOWLEDGEMENT', workflow: route.workflow, recipient: email, ...template })
  const acknowledgementStatus = delivery.status === 'sent' ? 'sent' : delivery.status === 'failed' ? 'failed' : 'skipped'
  await db.from('contact_cases').update({ acknowledgement_status: acknowledgementStatus, acknowledgement_sent_at: delivery.status === 'sent' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', created.id)

  return NextResponse.json({ success: true, duplicate: false, reference, status: 'received', acknowledgementStatus })
}
