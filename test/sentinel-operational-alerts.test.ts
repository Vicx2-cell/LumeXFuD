import { describe, expect, it } from 'vitest'
import { deriveOperationalProviderIssues, type OperationalFailureCounts } from '@/lib/sentinel'

const healthy: OperationalFailureCounts = {
  payment_failures_15m: 0,
  refund_failures_15m: 0,
  webhook_failures_15m: 0,
  email_failures_15m: 0,
  notification_failures_15m: 0,
  overdue_crons: [],
  redis_configured: true,
  redis_ok: true,
}

describe('Sentinel operational provider alerts', () => {
  it('flags Redis as SEV1 when configured but unreachable', () => {
    const issues = deriveOperationalProviderIssues({ ...healthy, redis_ok: false })
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV1', code: 'REDIS_UNREACHABLE' }))
  })

  it('flags payment/refund bursts as SEV1', () => {
    const issues = deriveOperationalProviderIssues({ ...healthy, payment_failures_15m: 2, refund_failures_15m: 1 })
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV1', code: 'PAYMENT_FAILURE_BURST' }))
  })

  it('flags webhook failure bursts as SEV1', () => {
    const issues = deriveOperationalProviderIssues({ ...healthy, webhook_failures_15m: 3 })
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV1', code: 'WEBHOOK_FAILURE_BURST' }))
  })

  it('flags email and notification bursts as SEV2', () => {
    const issues = deriveOperationalProviderIssues({ ...healthy, email_failures_15m: 5, notification_failures_15m: 5 })
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV2', code: 'EMAIL_FAILURE_BURST' }))
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV2', code: 'NOTIFICATION_FAILURE_BURST' }))
  })

  it('separates overdue money crons from non-money crons', () => {
    const issues = deriveOperationalProviderIssues({
      ...healthy,
      overdue_crons: [
        { key: 'release-payments', label: 'Release payments', money: true },
        { key: 'sentinel', label: 'Sentinel', money: false },
      ],
    })
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV1', code: 'MONEY_CRON_OVERDUE' }))
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'SEV2', code: 'CRON_OVERDUE' }))
  })
})
