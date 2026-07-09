import { describe, expect, it, vi } from 'vitest'
import { processLumiMessage } from '@/lib/lumi/actions'
import type { SessionPayload } from '@/lib/session'
import type { LumiConversationState } from '@/lib/lumi/types'

vi.mock('@/lib/customer-wallet', () => ({
  getCustomerWallet: vi.fn(async () => ({ balance_kobo: 125000 })),
  getTopupLimits: vi.fn(async () => ({ minKobo: 50000, maxKobo: 5000000 })),
}))

const session: SessionPayload = {
  sessionId: 'session-1',
  userId: '11111111-1111-4111-8111-111111111111',
  phone: '+2348000000000',
  role: 'customer',
}

const ctx = {
  db: {} as never,
  session,
  customerId: session.userId!,
}

describe('Lumi flow orchestration', () => {
  it('starts the funding flow and waits for an amount', async () => {
    const result = await processLumiMessage(ctx, 'fund my wallet', null)
    expect(result.response.reply).toContain('How much')
    expect(result.nextState?.step).toBe('awaiting_funding_amount')
  })

  it('transitions to confirmation once a funding amount arrives', async () => {
    const state: LumiConversationState = {
      version: 1,
      step: 'awaiting_funding_amount',
      activeIntent: 'fund_wallet',
      updatedAt: new Date().toISOString(),
    }
    const result = await processLumiMessage(ctx, 'add 5000', state)
    expect(result.response.reply).toContain('Paystack')
    expect(result.nextState?.step).toBe('awaiting_payment_confirmation')
    expect(result.nextState?.pendingAmount).toBe(5000)
  })

  it('requires explicit confirmation for pending top-ups', async () => {
    const state: LumiConversationState = {
      version: 1,
      step: 'awaiting_payment_confirmation',
      activeIntent: 'fund_wallet',
      pendingAmount: 5000,
      updatedAt: new Date().toISOString(),
    }
    const result = await processLumiMessage(ctx, 'yes', state)
    expect(result.response.quickReplies?.some((reply) => reply.value === 'confirm_funding')).toBe(true)
    expect(result.nextState?.step).toBe('awaiting_payment_confirmation')
  })

  it('clears an active flow when the user cancels', async () => {
    const state: LumiConversationState = {
      version: 1,
      step: 'awaiting_payment_confirmation',
      activeIntent: 'fund_wallet',
      pendingAmount: 5000,
      updatedAt: new Date().toISOString(),
    }
    const result = await processLumiMessage(ctx, 'never mind', state)
    expect(result.clearState).toBe(true)
    expect(result.response.reply).toContain('cleared')
  })
})
