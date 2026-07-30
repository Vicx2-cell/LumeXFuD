import type { SupabaseClient } from '@supabase/supabase-js'

export type OrderPaymentIntentStatus =
  | 'CREATED'
  | 'INITIALIZED'
  | 'VERIFIED'
  | 'FINALIZED'
  | 'QUARANTINED'
  | 'FAILED'

export interface OrderPaymentIntentRecord {
  id: string
  order_id: string
  customer_id: string | null
  guest_phone: string | null
  guest_name: string | null
  currency: string
  environment: 'test' | 'production'
  amount_kobo: number
  expected_vendor_allocation_kobo: number
  expected_rider_allocation_kobo: number
  expected_platform_allocation_kobo: number
  status: OrderPaymentIntentStatus
  idempotency_key: string
  internal_reference: string
  paystack_reference: string
  paystack_authorization_url: string | null
  paystack_access_code: string | null
  paystack_transaction_id: string | null
  callback_seen_at: string | null
  initialized_at: string | null
  verified_at: string | null
  finalized_at: string | null
  quarantined_at: string | null
  quarantine_reason: string | null
  provider_amount_kobo: number | null
  provider_currency: string | null
  provider_environment: string | null
  provider_payload: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type DB = SupabaseClient

function normalizeEnvironment(environment: string): 'test' | 'production' {
  return environment === 'production' ? 'production' : 'test'
}

export async function createOrderPaymentIntent(db: DB, input: {
  orderId: string
  customerId: string | null
  guestPhone: string | null
  guestName: string | null
  amountKobo: number
  currency: string
  environment: 'test' | 'production'
  expectedVendorAllocationKobo: number
  expectedRiderAllocationKobo: number
  expectedPlatformAllocationKobo: number
  idempotencyKey: string
  internalReference: string
  paystackReference: string
  metadata?: Record<string, unknown>
}): Promise<{ intent: OrderPaymentIntentRecord; replayed: boolean }> {
  const existing = await db.from('order_payment_intents')
    .select('*')
    .or(`order_id.eq.${input.orderId},idempotency_key.eq.${input.idempotencyKey},paystack_reference.eq.${input.paystackReference}`)
    .maybeSingle()

  if (existing.data) {
    const row = existing.data as OrderPaymentIntentRecord
    if (
      row.order_id !== input.orderId ||
      row.currency !== input.currency ||
      normalizeEnvironment(row.environment) !== input.environment ||
      row.amount_kobo !== input.amountKobo ||
      row.expected_vendor_allocation_kobo !== input.expectedVendorAllocationKobo ||
      row.expected_rider_allocation_kobo !== input.expectedRiderAllocationKobo ||
      row.expected_platform_allocation_kobo !== input.expectedPlatformAllocationKobo ||
      row.paystack_reference !== input.paystackReference ||
      row.internal_reference !== input.internalReference
    ) {
      throw new Error('order payment intent conflict')
    }
    return { intent: row, replayed: true }
  }

  const { data, error } = await db.from('order_payment_intents').insert({
    order_id: input.orderId,
    customer_id: input.customerId,
    guest_phone: input.guestPhone,
    guest_name: input.guestName,
    currency: input.currency,
    environment: input.environment,
    amount_kobo: input.amountKobo,
    expected_vendor_allocation_kobo: input.expectedVendorAllocationKobo,
    expected_rider_allocation_kobo: input.expectedRiderAllocationKobo,
    expected_platform_allocation_kobo: input.expectedPlatformAllocationKobo,
    status: 'CREATED',
    idempotency_key: input.idempotencyKey,
    internal_reference: input.internalReference,
    paystack_reference: input.paystackReference,
    metadata: input.metadata ?? {},
  }).select('*').single()

  if (error) {
    if (error.code === '23505') {
      const replay = await db.from('order_payment_intents')
        .select('*')
        .or(`order_id.eq.${input.orderId},idempotency_key.eq.${input.idempotencyKey},paystack_reference.eq.${input.paystackReference}`)
        .maybeSingle()
      if (replay.data) {
        return { intent: replay.data as OrderPaymentIntentRecord, replayed: true }
      }
    }
    throw new Error(`create_order_payment_intent failed: ${error.message}`)
  }

  return { intent: data as OrderPaymentIntentRecord, replayed: false }
}

export async function markOrderPaymentIntentInitialized(db: DB, params: {
  orderId: string
  authorizationUrl: string
  accessCode: string
  transactionId?: string | null
  providerPayload?: Record<string, unknown>
}): Promise<OrderPaymentIntentRecord> {
  const { data, error } = await db.from('order_payment_intents')
    .update({
      status: 'INITIALIZED',
      paystack_authorization_url: params.authorizationUrl,
      paystack_access_code: params.accessCode,
      paystack_transaction_id: params.transactionId ?? null,
      initialized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provider_payload: params.providerPayload ?? undefined,
    })
    .eq('order_id', params.orderId)
    .select('*')
    .single()

  if (error) throw new Error(`markOrderPaymentIntentInitialized failed: ${error.message}`)
  return data as OrderPaymentIntentRecord
}

export async function markOrderPaymentIntentVerified(db: DB, params: {
  orderId: string
  amountKobo: number
  currency: string
  environment: 'test' | 'production'
  providerPayload: Record<string, unknown>
}): Promise<OrderPaymentIntentRecord> {
  const { data, error } = await db.from('order_payment_intents')
    .update({
      status: 'VERIFIED',
      verified_at: new Date().toISOString(),
      provider_amount_kobo: params.amountKobo,
      provider_currency: params.currency,
      provider_environment: params.environment,
      provider_payload: params.providerPayload,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', params.orderId)
    .select('*')
    .single()
  if (error) throw new Error(`markOrderPaymentIntentVerified failed: ${error.message}`)
  return data as OrderPaymentIntentRecord
}

export async function finalizeOrderPaymentIntent(db: DB, params: {
  orderId: string
  providerPayload: Record<string, unknown>
}): Promise<OrderPaymentIntentRecord> {
  const { data, error } = await db.from('order_payment_intents')
    .update({
      status: 'FINALIZED',
      finalized_at: new Date().toISOString(),
      provider_payload: params.providerPayload,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', params.orderId)
    .neq('status', 'FINALIZED')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`finalizeOrderPaymentIntent failed: ${error.message}`)
  if (!data) {
    const fallback = await db.from('order_payment_intents').select('*').eq('order_id', params.orderId).maybeSingle()
    if (!fallback.data) throw new Error('order payment intent not found')
    return fallback.data as OrderPaymentIntentRecord
  }
  return data as OrderPaymentIntentRecord
}

export async function quarantineOrderPaymentIntent(db: DB, params: {
  orderId: string
  reason: string
  providerAmountKobo?: number | null
  providerCurrency?: string | null
  providerEnvironment?: string | null
  providerPayload?: Record<string, unknown>
}): Promise<OrderPaymentIntentRecord> {
  const { data, error } = await db.from('order_payment_intents')
    .update({
      status: 'QUARANTINED',
      quarantined_at: new Date().toISOString(),
      quarantine_reason: params.reason,
      provider_amount_kobo: params.providerAmountKobo ?? null,
      provider_currency: params.providerCurrency ?? null,
      provider_environment: params.providerEnvironment ?? null,
      provider_payload: params.providerPayload ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', params.orderId)
    .select('*')
    .single()
  if (error) throw new Error(`quarantineOrderPaymentIntent failed: ${error.message}`)
  return data as OrderPaymentIntentRecord
}

export async function findOrderPaymentIntentByReference(db: DB, reference: string): Promise<OrderPaymentIntentRecord | null> {
  const { data } = await db.from('order_payment_intents').select('*').eq('paystack_reference', reference).maybeSingle()
  return (data as OrderPaymentIntentRecord | null) ?? null
}
