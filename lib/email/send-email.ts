import 'server-only'

import { Resend } from 'resend'
import { z } from 'zod'
import { EMAIL_DOMAIN, EMAIL_IDENTITIES, EMAIL_WORKFLOWS, formatEmailIdentity, type EmailWorkflow } from './identities'

const emailSchema = z.string().trim().email().max(254)
const subjectSchema = z.string().trim().min(1).max(160).refine((value) => !/[\r\n]/.test(value), 'Invalid subject')
const idempotencySchema = z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9_:/.-]+$/)

export type EmailSendResult = {
  ok: boolean
  status: 'sent' | 'skipped' | 'failed'
  workflow: EmailWorkflow
  providerMessageId: string | null
  attempts: number
  errorCode: string | null
  retryable: boolean
}

export interface SendEmailInput {
  workflow: EmailWorkflow
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey: string
  eventId: string
  initiatedBy?: 'system' | 'admin' | 'founder'
}

type ResendResponse = Awaited<ReturnType<Resend['emails']['send']>>
export type EmailTransport = (payload: Parameters<Resend['emails']['send']>[0], options: { idempotencyKey: string }) => Promise<ResendResponse>

let client: Resend | null = null

export function normalizeEmail(value: unknown): string | null {
  const parsed = emailSchema.safeParse(value)
  return parsed.success && !/[\r\n]/.test(parsed.data) ? parsed.data.toLowerCase() : null
}

function configuredDomain(): string {
  const value = process.env.EMAIL_FROM_DOMAIN?.trim().toLowerCase() || EMAIL_DOMAIN
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value) ? value : EMAIL_DOMAIN
}

function deliveryEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production'
}

function defaultTransport(): EmailTransport | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return null
  client ??= new Resend(key)
  return (payload, options) => client!.emails.send(payload, options)
}

function isTransient(code: string): boolean {
  return ['rate_limit_exceeded', 'internal_server_error', 'application_error', 'transport_error'].includes(code)
}

function safeLog(result: EmailSendResult, input: SendEmailInput, recipient: string): void {
  const domain = recipient.split('@')[1] ?? 'invalid'
  console.info('[email.delivery]', {
    eventId: input.eventId,
    workflow: input.workflow,
    recipientDomain: domain,
    status: result.status,
    attempts: result.attempts,
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
  })
}

/** Policy-enforced Resend transport. Durable event claiming lives in the business-event layer. */
export async function sendEmail(input: SendEmailInput, transportOverride?: EmailTransport): Promise<EmailSendResult> {
  const policy = EMAIL_WORKFLOWS[input.workflow]
  const identity = EMAIL_IDENTITIES[policy.identity]
  const replyTo = EMAIL_IDENTITIES[policy.replyToIdentity]
  const recipient = normalizeEmail(input.to)
  const subject = subjectSchema.safeParse(input.subject)
  const idempotencyKey = idempotencySchema.safeParse(input.idempotencyKey)
  const actor = input.initiatedBy ?? 'system'

  let validationCode: string | null = null
  if (!recipient) validationCode = 'invalid_recipient'
  else if (!subject.success) validationCode = 'invalid_subject'
  else if (!idempotencyKey.success) validationCode = 'invalid_idempotency_key'
  else if (!input.text.trim() || !input.html.trim()) validationCode = 'missing_content'
  else if (!identity.automatedUse || !(identity.allowedWorkflowCategories as readonly string[]).includes(policy.category)) validationCode = 'sender_policy_mismatch'
  else if (policy.authorization === 'admin' && !['admin', 'founder'].includes(actor)) validationCode = 'unauthorized_workflow'
  else if (policy.authorization === 'founder' && actor !== 'founder') validationCode = 'unauthorized_workflow'

  if (validationCode) {
    const result: EmailSendResult = { ok: false, status: 'failed', workflow: input.workflow, providerMessageId: null, attempts: 0, errorCode: validationCode, retryable: false }
    safeLog(result, input, recipient ?? 'invalid')
    return result
  }

  if (!transportOverride && !deliveryEnabled()) {
    return { ok: false, status: 'skipped', workflow: input.workflow, providerMessageId: null, attempts: 0, errorCode: 'non_production', retryable: false }
  }
  const transport = transportOverride ?? defaultTransport()
  if (!transport) return { ok: false, status: 'skipped', workflow: input.workflow, providerMessageId: null, attempts: 0, errorCode: 'not_configured', retryable: false }

  const payload = {
    from: formatEmailIdentity(policy.identity, configuredDomain(), policy.displayNameOverride),
    replyTo: replyTo.address,
    to: [recipient!],
    subject: subject.data!,
    text: input.text,
    html: input.html,
    headers: { 'X-LumeX-Workflow': input.workflow, 'X-LumeX-Event': input.eventId },
  }

  let attempts = 0
  let lastCode = 'transport_error'
  while (attempts < 3) {
    attempts += 1
    try {
      const { data, error } = await transport(payload, { idempotencyKey: idempotencyKey.data! })
      if (data?.id) {
        const result: EmailSendResult = { ok: true, status: 'sent', workflow: input.workflow, providerMessageId: data.id, attempts, errorCode: null, retryable: false }
        safeLog(result, input, recipient!)
        return result
      }
      lastCode = error?.name ?? 'resend_error'
    } catch {
      lastCode = 'transport_error'
    }
    if (!isTransient(lastCode)) break
  }
  const result: EmailSendResult = { ok: false, status: 'failed', workflow: input.workflow, providerMessageId: null, attempts, errorCode: lastCode, retryable: isTransient(lastCode) }
  safeLog(result, input, recipient!)
  return result
}
