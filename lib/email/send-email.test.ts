import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_IDENTITIES, EMAIL_WORKFLOWS, type EmailWorkflow } from './identities'
import { sendEmail, type EmailTransport } from './send-email'

describe('central email policy', () => {
  beforeEach(() => {
    process.env.EMAIL_FROM_DOMAIN = 'lumexfud.com.ng'
  })

  it.each(Object.keys(EMAIL_WORKFLOWS) as EmailWorkflow[])('%s selects its policy From and Reply-To', async (workflow) => {
    const transport = vi.fn().mockResolvedValue({ data: { id: `provider-${workflow}` }, error: null }) as unknown as EmailTransport
    const policy = EMAIL_WORKFLOWS[workflow]
    const actor = policy.authorization === 'founder' ? 'founder' : policy.authorization === 'admin' ? 'admin' : 'system'
    const result = await sendEmail({ workflow, to: 'person@example.com', subject: 'A valid subject', text: 'Why this was sent. Action: open the app.', html: '<p>Why this was sent.</p>', idempotencyKey: `test/${workflow}/12345678`, eventId: `event-${workflow}`, initiatedBy: actor }, transport)
    const payload = vi.mocked(transport).mock.calls[0][0]
    expect(result.status).toBe('sent')
    expect(payload.from).toContain(`<${EMAIL_IDENTITIES[policy.identity].address}>`)
    expect(payload.replyTo).toBe(EMAIL_IDENTITIES[policy.replyToIdentity].address)
  })

  it('retries transient failures and returns a stable failure result', async () => {
    const transport = vi.fn().mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'busy' } }) as unknown as EmailTransport
    const result = await sendEmail({ workflow: 'order_confirmation', to: 'person@example.com', subject: 'Order confirmed', text: 'Your order was confirmed.', html: '<p>Your order was confirmed.</p>', idempotencyKey: 'order/test/12345678', eventId: 'event-1' }, transport)
    expect(transport).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ ok: false, status: 'failed', workflow: 'order_confirmation', providerMessageId: null, attempts: 3, errorCode: 'rate_limit_exceeded', retryable: true })
  })

  it('rejects founder-only automation without founder authorization', async () => {
    const transport = vi.fn() as unknown as EmailTransport
    const result = await sendEmail({ workflow: 'founder_announcement', to: 'person@example.com', subject: 'Founder note', text: 'A note.', html: '<p>A note.</p>', idempotencyKey: 'founder/test/12345678', eventId: 'event-2', initiatedBy: 'admin' }, transport)
    expect(result.errorCode).toBe('unauthorized_workflow')
    expect(transport).not.toHaveBeenCalled()
  })

  it('blocks header injection before transport', async () => {
    const transport = vi.fn() as unknown as EmailTransport
    const result = await sendEmail({ workflow: 'support_acknowledgement', to: 'person@example.com', subject: 'Hello\r\nBcc: bad@example.com', text: 'Saved.', html: '<p>Saved.</p>', idempotencyKey: 'support/test/12345678', eventId: 'event-3' }, transport)
    expect(result.errorCode).toBe('invalid_subject')
    expect(transport).not.toHaveBeenCalled()
  })

  it('uses the required distinct founder display names', async () => {
    const transport = vi.fn().mockResolvedValue({ data: { id: 'provider-founder' }, error: null }) as unknown as EmailTransport
    await sendEmail({ workflow: 'customer_welcome', to: 'person@example.com', subject: 'Welcome', text: 'Welcome.', html: '<p>Welcome.</p>', idempotencyKey: 'welcome/test/12345678', eventId: 'event-welcome' }, transport)
    await sendEmail({ workflow: 'founder_announcement', to: 'person@example.com', subject: 'Founder note', text: 'A note.', html: '<p>A note.</p>', idempotencyKey: 'founder/test/12345678', eventId: 'event-founder', initiatedBy: 'founder' }, transport)
    expect(vi.mocked(transport).mock.calls[0][0].from).toBe('Chibuike from LumeX Fud <chibuike@lumexfud.com.ng>')
    expect(vi.mocked(transport).mock.calls[1][0].from).toBe('Chibuike at LumeX Fud <chibuike@lumexfud.com.ng>')
  })
})
