import 'server-only'

import type { createSupabaseAdmin } from '@/lib/supabase/server'
import { sendOrderConfirmationEmail, sendOrderStatusEmail, sendDelayedOrderEmail, sendWelcomeEmail, type TransactionalEmailResult } from '@/lib/transactional-email'
import { renderCaseAcknowledgement, renderApplicationEmail } from './templates'
import { deliverWorkflowEmail, type WorkflowDeliveryResult } from './workflow-email'
import type { EmailWorkflow } from './identities'

type DB = ReturnType<typeof createSupabaseAdmin>
type RetryResult = TransactionalEmailResult | WorkflowDeliveryResult | { status: 'skipped'; reason: 'unsupported_event' | 'event_not_failed' | 'record_not_found' }

export async function retryEmailEvent(db: DB, eventId: string): Promise<RetryResult> {
  const { data: event } = await db.from('transactional_email_events').select('id, event_key, kind, status').eq('id', eventId).maybeSingle()
  if (!event) return { status: 'skipped', reason: 'record_not_found' }
  if (event.status !== 'FAILED') return { status: 'skipped', reason: 'event_not_failed' }
  const key = String(event.event_key)
  const entityId = key.split(':').at(-1) ?? ''

  if (key.startsWith('order-confirmation:')) return sendOrderConfirmationEmail(db, { orderId: entityId })
  if (key.startsWith('order-delayed:')) return sendDelayedOrderEmail(db, { orderId: entityId })
  if (key.startsWith('order-out-for-delivery:')) return sendOrderStatusEmail(db, { orderId: entityId, newStatus: 'PICKED_UP', statusEventId: `admin-retry:${eventId}` })
  if (key.startsWith('order-delivered:')) return sendOrderStatusEmail(db, { orderId: entityId, newStatus: 'DELIVERED', statusEventId: `admin-retry:${eventId}` })
  if (key.startsWith('welcome:')) {
    const { data: customer } = await db.from('customers').select('id, email, name').eq('id', entityId).maybeSingle()
    return customer ? sendWelcomeEmail(db, { customerId: customer.id, email: customer.email, name: customer.name }) : { status: 'skipped', reason: 'record_not_found' }
  }
  if (key.startsWith('contact-ack:')) {
    const { data: record } = await db.from('contact_cases').select('id, requester_name, requester_email, reference_number, intent').eq('id', entityId).maybeSingle()
    if (!record) return { status: 'skipped', reason: 'record_not_found' }
    const workflows: Record<string, EmailWorkflow> = { general: 'general_contact_acknowledgement', support: 'support_acknowledgement', complaint: 'complaint_received', refund: 'support_acknowledgement', partnership: 'partnership_acknowledgement', sponsorship: 'sponsorship_acknowledgement', security: 'security_report_acknowledgement', fraud: 'fraud_report_acknowledgement', press: 'press_acknowledgement', privacy: 'privacy_request_acknowledgement', deletion: 'deletion_request_acknowledgement', legal: 'legal_notice_acknowledgement' }
    const workflow = workflows[String(record.intent)]
    if (!workflow) return { status: 'skipped', reason: 'unsupported_event' }
    const template = renderCaseAcknowledgement({ workflow, name: record.requester_name, reference: record.reference_number, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/contact` })
    return deliverWorkflowEmail(db, { eventKey: key, eventKind: 'CONTACT_ACKNOWLEDGEMENT', workflow, recipient: record.requester_email, initiatedBy: 'admin', ...template })
  }
  if (/^(application-received|application_(?:approved|rejected)|(?:vendor|rider)-welcome):/.test(key)) {
    const parts = key.split(':')
    const kind: 'vendor' | 'rider' = key.startsWith('vendor-welcome:') ? 'vendor' : key.startsWith('rider-welcome:') ? 'rider' : parts.at(-2) === 'vendor' ? 'vendor' : 'rider'
    const table = kind === 'vendor' ? 'vendor_applications' : 'rider_applications'
    const nameColumn = kind === 'vendor' ? 'owner_name' : 'full_name'
    const { data: record } = await db.from(table).select(`id, email, reference_number, ${nameColumn}`).eq('id', entityId).maybeSingle()
    if (!record?.email || !record.reference_number) return { status: 'skipped', reason: 'record_not_found' }
    const workflow: 'application_received' | 'application_approved' | 'application_rejected' | 'vendor_welcome' | 'rider_welcome' = key.startsWith('application-received:') ? 'application_received' : key.startsWith('application_approved:') ? 'application_approved' : key.startsWith('application_rejected:') ? 'application_rejected' : kind === 'vendor' ? 'vendor_welcome' : 'rider_welcome'
    const eventKind = workflow === 'application_received' ? 'APPLICATION_RECEIVED' : workflow === 'application_approved' ? 'APPLICATION_APPROVED' : workflow === 'application_rejected' ? 'APPLICATION_REJECTED' : kind === 'vendor' ? 'VENDOR_WELCOME' : 'RIDER_WELCOME'
    const applicantName = kind === 'vendor' ? (record as { owner_name?: unknown }).owner_name : (record as { full_name?: unknown }).full_name
    const template = renderApplicationEmail({ workflow, name: String(applicantName ?? ''), kind, reference: record.reference_number, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/auth` })
    return deliverWorkflowEmail(db, { eventKey: key, eventKind, workflow, recipient: record.email, initiatedBy: 'admin', ...template })
  }
  return { status: 'skipped', reason: 'unsupported_event' }
}
