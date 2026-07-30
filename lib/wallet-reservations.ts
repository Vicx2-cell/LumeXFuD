import { createSupabaseAdmin } from './supabase/server'

export async function reserveWalletBalance(params: {
  customerId: string
  orderId: string
  amountKobo: number
  currency?: string
  environment?: 'test' | 'production'
  idempotencyKey: string
  expiresAt: string
  correlationId?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ reservationId: string; journalId: string; replayed: boolean; status: string }> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('reserve_wallet_balance', {
    p_customer_id: params.customerId,
    p_order_id: params.orderId,
    p_amount_kobo: params.amountKobo,
    p_currency: params.currency ?? 'NGN',
    p_environment: params.environment ?? 'production',
    p_idempotency_key: params.idempotencyKey,
    p_expires_at: params.expiresAt,
    p_correlation_id: params.correlationId ?? null,
    p_metadata: params.metadata ?? {},
  })

  if (error) throw new Error(`reserve_wallet_balance RPC failed: ${error.message}`)
  const row = (data as Array<{ reservation_id: string; journal_id: string; replayed: boolean; status: string }>)[0]
  return {
    reservationId: row.reservation_id,
    journalId: row.journal_id,
    replayed: row.replayed,
    status: row.status,
  }
}

export async function consumeWalletReservation(params: {
  reservationId: string
  idempotencyKey: string
  actorType?: string
  actorId?: string | null
  correlationId?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ reservationId: string; journalId: string; replayed: boolean; status: string }> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('consume_wallet_reservation', {
    p_reservation_id: params.reservationId,
    p_idempotency_key: params.idempotencyKey,
    p_actor_type: params.actorType ?? 'system',
    p_actor_id: params.actorId ?? null,
    p_correlation_id: params.correlationId ?? null,
    p_metadata: params.metadata ?? {},
  })

  if (error) throw new Error(`consume_wallet_reservation RPC failed: ${error.message}`)
  const row = (data as Array<{ reservation_id: string; journal_id: string; replayed: boolean; status: string }>)[0]
  return {
    reservationId: row.reservation_id,
    journalId: row.journal_id,
    replayed: row.replayed,
    status: row.status,
  }
}

export async function releaseWalletReservation(params: {
  reservationId: string
  reason: string
  idempotencyKey: string
  actorType?: string
  actorId?: string | null
  correlationId?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ reservationId: string; journalId: string; replayed: boolean; status: string }> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('release_wallet_reservation', {
    p_reservation_id: params.reservationId,
    p_reason: params.reason,
    p_idempotency_key: params.idempotencyKey,
    p_actor_type: params.actorType ?? 'system',
    p_actor_id: params.actorId ?? null,
    p_correlation_id: params.correlationId ?? null,
    p_metadata: params.metadata ?? {},
  })

  if (error) throw new Error(`release_wallet_reservation RPC failed: ${error.message}`)
  const row = (data as Array<{ reservation_id: string; journal_id: string; replayed: boolean; status: string }>)[0]
  return {
    reservationId: row.reservation_id,
    journalId: row.journal_id,
    replayed: row.replayed,
    status: row.status,
  }
}

export async function findWalletReservationByOrder(orderId: string): Promise<{
  id: string
  customer_id: string
  order_id: string
  amount_kobo: number
  currency: string
  environment: string
  status: string
} | null> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('wallet_reservations')
    .select('id, customer_id, order_id, amount_kobo, currency, environment, status')
    .eq('order_id', orderId)
    .maybeSingle()
  return (data as {
    id: string
    customer_id: string
    order_id: string
    amount_kobo: number
    currency: string
    environment: string
    status: string
  } | null) ?? null
}
