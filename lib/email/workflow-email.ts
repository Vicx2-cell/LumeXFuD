import 'server-only'

import type { createSupabaseAdmin } from '@/lib/supabase/server'
import { sendEmail, normalizeEmail, type EmailSendResult } from './send-email'
import type { EmailWorkflow } from './identities'

type DB = ReturnType<typeof createSupabaseAdmin>

export type WorkflowDeliveryResult = EmailSendResult | { status: 'skipped'; reason: 'already_processed' | 'no_recipient' | 'event_claim_failed' }

export async function deliverWorkflowEmail(db: DB, input: {
  eventKey: string
  eventKind: string
  workflow: EmailWorkflow
  recipient: string
  subject: string
  text: string
  html: string
  initiatedBy?: 'system' | 'admin' | 'founder'
}): Promise<WorkflowDeliveryResult> {
  const recipient = normalizeEmail(input.recipient)
  if (!recipient) return { status: 'skipped', reason: 'no_recipient' }
  const { data, error } = await db.rpc('claim_transactional_email_event', { p_event_key: input.eventKey, p_kind: input.eventKind, p_recipient: recipient })
  if (error) {
    console.error('[email.event_claim_failed]', { workflow: input.workflow, eventKind: input.eventKind, code: error.code ?? 'database_error' })
    return { status: 'skipped', reason: 'event_claim_failed' }
  }
  const row = (data as Array<{ event_id: string; claimed: boolean }> | null)?.[0]
  if (!row?.claimed) return { status: 'skipped', reason: 'already_processed' }
  const result = await sendEmail({ workflow: input.workflow, to: recipient, subject: input.subject, text: input.text, html: input.html, idempotencyKey: `${input.workflow}/${row.event_id}`, eventId: row.event_id, initiatedBy: input.initiatedBy })
  await db.rpc('finish_transactional_email_event', {
    p_event_id: row.event_id,
    p_status: result.status === 'sent' ? 'SENT' : result.status === 'failed' ? 'FAILED' : 'SKIPPED',
    p_resend_id: result.providerMessageId,
    p_error_code: result.errorCode,
  })
  return result
}
