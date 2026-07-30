import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

export async function reserveRefundLedger(params: {
  db: DB
  idempotencyKey: string
  businessReference: string
  correlationId: string
  amountKobo: number
  currency?: string
  environment: 'test' | 'production'
  actorType?: string
  actorId?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ journalId: string; replayed: boolean }> {
  const currency = params.currency ?? 'NGN'
  const [refundPayableId, clearingId] = await Promise.all([
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'REFUND_PAYABLE',
      p_owner_type: 'PLATFORM',
      p_owner_id: null,
      p_currency: currency,
      p_environment: params.environment,
      p_metadata: { source: 'refund_reservation', ...params.metadata },
    }),
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'COLLECTION_CLEARING',
      p_owner_type: 'PLATFORM',
      p_owner_id: null,
      p_currency: currency,
      p_environment: params.environment,
      p_metadata: { source: 'refund_reservation', ...params.metadata },
    }),
  ])

  if (refundPayableId.error) throw new Error(`Could not ensure refund payable account: ${refundPayableId.error.message}`)
  if (clearingId.error) throw new Error(`Could not ensure collection clearing account: ${clearingId.error.message}`)

  const posted = await params.db.rpc('post_ledger_journal', {
    p_journal_type: 'REFUND_RESERVATION',
    p_business_reference: params.businessReference,
    p_idempotency_key: params.idempotencyKey,
    p_currency: currency,
    p_source: 'refund_request',
    p_actor_type: params.actorType ?? 'system',
    p_actor_id: params.actorId ?? null,
    p_correlation_id: params.correlationId,
    p_metadata: {
      environment: params.environment,
      amount_kobo: params.amountKobo,
      ...params.metadata,
    },
    p_reversal_of_journal_id: null,
    p_entries: [
      {
      account_id: clearingId.data as string,
      side: 'DEBIT',
      amount_kobo: params.amountKobo,
      metadata: { flow: 'refund_reservation' } as Record<string, unknown>,
    },
    {
      account_id: refundPayableId.data as string,
      side: 'CREDIT',
      amount_kobo: params.amountKobo,
      metadata: { flow: 'refund_reservation' } as Record<string, unknown>,
    },
  ],
  })

  if (posted.error) throw new Error(`Could not post refund reservation journal: ${posted.error.message}`)
  return { journalId: posted.data?.[0]?.journal_id as string, replayed: !!posted.data?.[0]?.replayed }
}

export async function settleRefundLedger(params: {
  db: DB
  idempotencyKey: string
  businessReference: string
  correlationId: string
  amountKobo: number
  walletAmountKobo?: number
  paystackAmountKobo?: number
  customerId?: string | null
  currency?: string
  environment: 'test' | 'production'
  actorType?: string
  actorId?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ journalId: string; replayed: boolean }> {
  const currency = params.currency ?? 'NGN'
  const walletAmount = Math.max(0, Number(params.walletAmountKobo) || 0)
  const paystackAmount = Math.max(0, Number(params.paystackAmountKobo) || 0)
  const total = walletAmount + paystackAmount
  if (total <= 0) {
    return { journalId: '', replayed: true }
  }

  const [refundPayableId, customerAvailableId, clearingId] = await Promise.all([
    params.db.rpc('ensure_financial_account', {
      p_account_type: 'REFUND_PAYABLE',
      p_owner_type: 'PLATFORM',
      p_owner_id: null,
      p_currency: currency,
      p_environment: params.environment,
      p_metadata: { source: 'refund_settlement', ...params.metadata },
    }),
    walletAmount > 0 && params.customerId
      ? params.db.rpc('ensure_financial_account', {
          p_account_type: 'CUSTOMER_AVAILABLE',
          p_owner_type: 'CUSTOMER',
          p_owner_id: params.customerId,
          p_currency: currency,
          p_environment: params.environment,
          p_metadata: { source: 'refund_settlement', ...params.metadata },
        })
      : Promise.resolve({ data: null, error: null }),
    paystackAmount > 0
      ? params.db.rpc('ensure_financial_account', {
          p_account_type: 'COLLECTION_CLEARING',
          p_owner_type: 'PLATFORM',
          p_owner_id: null,
          p_currency: currency,
          p_environment: params.environment,
          p_metadata: { source: 'refund_settlement', ...params.metadata },
        })
      : Promise.resolve({ data: null, error: null }),
  ])

  if (refundPayableId.error) throw new Error(`Could not ensure refund payable account: ${refundPayableId.error.message}`)
  if (customerAvailableId.error) throw new Error(`Could not ensure customer available account: ${customerAvailableId.error.message}`)
  if (clearingId.error) throw new Error(`Could not ensure collection clearing account: ${clearingId.error.message}`)

  const entries = [
    {
      account_id: refundPayableId.data as string,
      side: 'DEBIT',
      amount_kobo: total,
      metadata: { flow: 'refund_settlement' } as Record<string, unknown>,
    },
  ]
  if (walletAmount > 0 && customerAvailableId.data) {
    entries.push({
      account_id: customerAvailableId.data as string,
      side: 'CREDIT',
      amount_kobo: walletAmount,
      metadata: { flow: 'refund_settlement', destination: 'customer_wallet' } as Record<string, unknown>,
    })
  }
  if (paystackAmount > 0 && clearingId.data) {
    entries.push({
      account_id: clearingId.data as string,
      side: 'CREDIT',
      amount_kobo: paystackAmount,
      metadata: { flow: 'refund_settlement', destination: 'paystack' } as Record<string, unknown>,
    })
  }

  const posted = await params.db.rpc('post_ledger_journal', {
    p_journal_type: 'REFUND_SETTLEMENT',
    p_business_reference: params.businessReference,
    p_idempotency_key: params.idempotencyKey,
    p_currency: currency,
    p_source: 'refund_settlement',
    p_actor_type: params.actorType ?? 'system',
    p_actor_id: params.actorId ?? null,
    p_correlation_id: params.correlationId,
    p_metadata: {
      environment: params.environment,
      amount_kobo: total,
      wallet_amount_kobo: walletAmount,
      paystack_amount_kobo: paystackAmount,
      ...params.metadata,
    },
    p_reversal_of_journal_id: null,
    p_entries: entries,
  })

  if (posted.error) throw new Error(`Could not post refund settlement journal: ${posted.error.message}`)
  return { journalId: posted.data?.[0]?.journal_id as string, replayed: !!posted.data?.[0]?.replayed }
}
