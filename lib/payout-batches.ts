import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

export type PayoutBatchStatus = 'DRAFT' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type PayoutTransferStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED'

export interface PayoutBatchRecord {
  id: string
  batch_reference: string
  beneficiary_type: 'VENDOR' | 'RIDER'
  beneficiary_id: string
  environment: 'test' | 'production'
  currency: string
  total_amount_kobo: number
  item_count: number
  status: PayoutBatchStatus
  approved_by: string | null
  approved_at: string | null
  kill_switch_snapshot: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PayoutBatchItemRecord {
  id: string
  batch_id: string
  beneficiary_type: 'VENDOR' | 'RIDER'
  beneficiary_id: string
  payment_profile_id: string | null
  amount_kobo: number
  currency: string
  environment: 'test' | 'production'
  bank_name: string
  bank_code: string
  bank_account_last4: string
  bank_account_masked: string
  bank_account_name: string
  paystack_recipient_code: string
  paystack_subaccount_code: string | null
  transfer_reference: string
  paystack_transfer_code: string | null
  status: PayoutTransferStatus
  snapshot_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PayoutTransferAttemptRecord {
  id: string
  payout_batch_item_id: string
  attempt_no: number
  transfer_reference: string
  paystack_transfer_code: string | null
  status: PayoutTransferStatus
  provider_payload: Record<string, unknown>
  failure_reason: string | null
  initiated_at: string
  verified_at: string | null
  succeeded_at: string | null
  failed_at: string | null
  reversed_at: string | null
  created_at: string
  updated_at: string
}

export async function createPayoutBatch(db: DB, input: {
  batchReference: string
  beneficiaryType: 'VENDOR' | 'RIDER'
  beneficiaryId: string
  environment: 'test' | 'production'
  currency: string
  totalAmountKobo: number
  itemCount: number
  metadata?: Record<string, unknown>
  killSwitchSnapshot?: string | null
}): Promise<{ batch: PayoutBatchRecord; replayed: boolean }> {
  const existing = await db
    .from('payout_batches')
    .select('*')
    .eq('batch_reference', input.batchReference)
    .maybeSingle()
  if (existing.data) {
    return { batch: existing.data as PayoutBatchRecord, replayed: true }
  }

  const { data, error } = await db.from('payout_batches').insert({
    batch_reference: input.batchReference,
    beneficiary_type: input.beneficiaryType,
    beneficiary_id: input.beneficiaryId,
    environment: input.environment,
    currency: input.currency,
    total_amount_kobo: input.totalAmountKobo,
    item_count: input.itemCount,
    status: 'DRAFT',
    kill_switch_snapshot: input.killSwitchSnapshot ?? null,
    metadata: input.metadata ?? {},
  }).select('*').single()

  if (error) throw new Error(`createPayoutBatch failed: ${error.message}`)
  return { batch: data as PayoutBatchRecord, replayed: false }
}

export async function createPayoutBatchItem(db: DB, input: {
  batchId: string
  beneficiaryType: 'VENDOR' | 'RIDER'
  beneficiaryId: string
  paymentProfileId: string | null
  amountKobo: number
  currency: string
  environment: 'test' | 'production'
  bankName: string
  bankCode: string
  bankAccountLast4: string
  bankAccountMasked: string
  bankAccountName: string
  paystackRecipientCode: string
  paystackSubaccountCode?: string | null
  transferReference: string
  snapshotMetadata?: Record<string, unknown>
}): Promise<{ item: PayoutBatchItemRecord; replayed: boolean }> {
  const existing = await db.from('payout_batch_items').select('*').eq('transfer_reference', input.transferReference).maybeSingle()
  if (existing.data) {
    return { item: existing.data as PayoutBatchItemRecord, replayed: true }
  }

  const { data, error } = await db.from('payout_batch_items').insert({
    batch_id: input.batchId,
    beneficiary_type: input.beneficiaryType,
    beneficiary_id: input.beneficiaryId,
    payment_profile_id: input.paymentProfileId,
    amount_kobo: input.amountKobo,
    currency: input.currency,
    environment: input.environment,
    bank_name: input.bankName,
    bank_code: input.bankCode,
    bank_account_last4: input.bankAccountLast4,
    bank_account_masked: input.bankAccountMasked,
    bank_account_name: input.bankAccountName,
    paystack_recipient_code: input.paystackRecipientCode,
    paystack_subaccount_code: input.paystackSubaccountCode ?? null,
    transfer_reference: input.transferReference,
    status: 'PENDING',
    snapshot_metadata: input.snapshotMetadata ?? {},
  }).select('*').single()

  if (error) throw new Error(`createPayoutBatchItem failed: ${error.message}`)
  return { item: data as PayoutBatchItemRecord, replayed: false }
}

export async function recordPayoutTransferAttempt(db: DB, input: {
  payoutBatchItemId: string
  transferReference: string
  providerPayload?: Record<string, unknown>
}): Promise<{ attempt: PayoutTransferAttemptRecord; replayed: boolean }> {
  const existing = await db.from('payout_transfer_attempts').select('*').eq('transfer_reference', input.transferReference).maybeSingle()
  if (existing.data) {
    return { attempt: existing.data as PayoutTransferAttemptRecord, replayed: true }
  }

  const { data: attempts } = await db
    .from('payout_transfer_attempts')
    .select('attempt_no')
    .eq('payout_batch_item_id', input.payoutBatchItemId)
  const existingAttempts = Array.isArray(attempts)
    ? (attempts as Array<{ attempt_no?: number }>)
    : attempts
      ? ([attempts] as Array<{ attempt_no?: number }>)
      : []
  const attemptNo = existingAttempts.length + 1

  const { data, error } = await db.from('payout_transfer_attempts').insert({
    payout_batch_item_id: input.payoutBatchItemId,
    attempt_no: attemptNo,
    transfer_reference: input.transferReference,
    status: 'PENDING',
    provider_payload: input.providerPayload ?? {},
  }).select('*').single()
  if (error) throw new Error(`recordPayoutTransferAttempt failed: ${error.message}`)
  return { attempt: data as PayoutTransferAttemptRecord, replayed: false }
}

export async function markPayoutBatchStatus(db: DB, input: {
  batchReference: string
  status: PayoutBatchStatus
  approvedBy?: string | null
  approvedAt?: string | null
  killSwitchSnapshot?: string | null
  metadata?: Record<string, unknown>
}): Promise<PayoutBatchRecord | null> {
  const payload: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  }
  if (input.approvedBy !== undefined) payload.approved_by = input.approvedBy
  if (input.approvedAt !== undefined) payload.approved_at = input.approvedAt
  if (input.killSwitchSnapshot !== undefined) payload.kill_switch_snapshot = input.killSwitchSnapshot
  if (input.metadata !== undefined) payload.metadata = input.metadata

  const { data, error } = await db
    .from('payout_batches')
    .update(payload)
    .eq('batch_reference', input.batchReference)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`markPayoutBatchStatus failed: ${error.message}`)
  return (data as PayoutBatchRecord | null) ?? null
}

export async function markPayoutBatchItemStatus(db: DB, input: {
  transferReference: string
  status: PayoutTransferStatus
  paystackTransferCode?: string | null
  snapshotMetadata?: Record<string, unknown>
}): Promise<PayoutBatchItemRecord | null> {
  const payload: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  }
  if (input.paystackTransferCode !== undefined) payload.paystack_transfer_code = input.paystackTransferCode
  if (input.snapshotMetadata !== undefined) payload.snapshot_metadata = input.snapshotMetadata

  const { data, error } = await db
    .from('payout_batch_items')
    .update(payload)
    .eq('transfer_reference', input.transferReference)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`markPayoutBatchItemStatus failed: ${error.message}`)
  return (data as PayoutBatchItemRecord | null) ?? null
}

export async function findPayoutBatchItemByTransferCode(db: DB, transferCode: string): Promise<PayoutBatchItemRecord | null> {
  const { data, error } = await db
    .from('payout_batch_items')
    .select('*')
    .eq('paystack_transfer_code', transferCode)
    .maybeSingle()
  if (error) throw new Error(`findPayoutBatchItemByTransferCode failed: ${error.message}`)
  return (data as PayoutBatchItemRecord | null) ?? null
}

export async function findPayoutTransferAttemptByTransferCode(db: DB, transferCode: string): Promise<PayoutTransferAttemptRecord | null> {
  const { data, error } = await db
    .from('payout_transfer_attempts')
    .select('*')
    .eq('paystack_transfer_code', transferCode)
    .maybeSingle()
  if (error) throw new Error(`findPayoutTransferAttemptByTransferCode failed: ${error.message}`)
  return (data as PayoutTransferAttemptRecord | null) ?? null
}

export async function markPayoutTransferAttemptStatus(db: DB, input: {
  transferReference: string
  status: PayoutTransferStatus
  transferCode?: string | null
  failureReason?: string | null
  providerPayload?: Record<string, unknown>
}): Promise<PayoutTransferAttemptRecord | null> {
  const payload: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  }
  if (input.transferCode !== undefined) payload.paystack_transfer_code = input.transferCode
  if (input.failureReason !== undefined) payload.failure_reason = input.failureReason
  if (input.providerPayload !== undefined) payload.provider_payload = input.providerPayload
  if (input.status === 'SUCCESS') payload.succeeded_at = new Date().toISOString()
  if (input.status === 'FAILED') payload.failed_at = new Date().toISOString()
  if (input.status === 'REVERSED') payload.reversed_at = new Date().toISOString()

  const { data, error } = await db
    .from('payout_transfer_attempts')
    .update(payload)
    .eq('transfer_reference', input.transferReference)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`markPayoutTransferAttemptStatus failed: ${error.message}`)
  return (data as PayoutTransferAttemptRecord | null) ?? null
}
