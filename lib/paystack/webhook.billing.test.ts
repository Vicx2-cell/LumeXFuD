import { describe, expect, it, vi, beforeEach } from 'vitest'
import { processWebhookAsync } from './webhook'

const mocks = vi.hoisted(() => ({
  processPremiumOrBoostWebhook: vi.fn(async () => undefined),
}))

vi.mock('./billing', () => ({
  processPremiumOrBoostWebhook: mocks.processPremiumOrBoostWebhook,
}))

vi.mock('../supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from() {
      return {
        select() { return this },
        eq() { return this },
        in() { return this },
        update() { return this },
        maybeSingle: async () => ({ data: null }),
        single: async () => ({ data: null }),
      }
    },
  })),
}))

vi.mock('../notify', () => ({ sendWhatsAppWithFallback: vi.fn(async () => undefined) }))
vi.mock('../notify-templates', () => ({ renderTemplate: vi.fn(() => '') }))
vi.mock('../notifications', () => ({ notifyInApp: vi.fn(async () => undefined) }))
vi.mock('../push', () => ({ sendPushToUser: vi.fn(async () => undefined) }))
vi.mock('../platform-earnings', () => ({ recordPlatformEarning: vi.fn(async () => undefined) }))
vi.mock('../customer-wallet', () => ({
  processCustomerTopup: vi.fn(async () => undefined),
  spendCustomerWallet: vi.fn(async () => ({ success: true })),
  isCustomerWalletEnabled: vi.fn(async () => true),
}))
vi.mock('./transfer', () => ({ refundTransaction: vi.fn(async () => undefined) }))
vi.mock('./init', () => ({ verifyPaystackTransaction: vi.fn(async () => ({ status: 'success', amount: 1000 })) }))
vi.mock('../security-events', () => ({ recordSecurityEvent: vi.fn(async () => undefined) }))

describe('paystack billing webhook routing', () => {
  beforeEach(() => {
    mocks.processPremiumOrBoostWebhook.mockClear()
  })

  it('routes premium success charges to the billing handler', async () => {
    await processWebhookAsync({
      event: 'charge.success',
      data: {
        reference: 'PREM-1',
        amount: 5000,
        metadata: { type: 'PREMIUM_SUBSCRIPTION', plan_key: 'vendor-premium' },
      },
    })

    expect(mocks.processPremiumOrBoostWebhook).toHaveBeenCalledWith('charge.success', expect.objectContaining({
      reference: 'PREM-1',
    }))
  })

  it('routes boost failed charges to the billing handler', async () => {
    await processWebhookAsync({
      event: 'charge.failed',
      data: {
        reference: 'BOST-1',
        amount: 15000,
        metadata: { type: 'BOOST_PURCHASE', boost_package_key: 'boost-3d' },
      },
    })

    expect(mocks.processPremiumOrBoostWebhook).toHaveBeenCalledWith('charge.failed', expect.objectContaining({
      reference: 'BOST-1',
    }))
  })
})
