import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

export type ReconciliationRunStatus = 'RUNNING' | 'COMPLETED' | 'SHORTFALL' | 'FAILED'
export type ReconciliationDiscrepancyStatus = 'OPEN' | 'UNDER_REVIEW' | 'REPAIRED' | 'DISMISSED'
export type ReconciliationSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface ReconciliationRunRecord {
  id: string
  run_reference: string
  run_type: string
  environment: 'test' | 'production'
  source_reference: string | null
  status: ReconciliationRunStatus
  summary: Record<string, unknown>
  created_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ReconciliationDiscrepancyRecord {
  id: string
  reconciliation_run_id: string
  entity_type: string
  internal_reference: string
  provider_reference: string | null
  expected_amount_kobo: number
  actual_amount_kobo: number
  currency: string
  environment: 'test' | 'production'
  severity: ReconciliationSeverity
  status: ReconciliationDiscrepancyStatus
  investigation_notes: string | null
  repair_journal_id: string | null
  resolver: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export async function createReconciliationRun(db: DB, params: {
  runType: string
  environment: 'test' | 'production'
  sourceReference?: string | null
  status?: ReconciliationRunStatus
  summary?: Record<string, unknown>
  createdBy?: string | null
  runReference?: string
}): Promise<ReconciliationRunRecord> {
  const runReference = params.runReference ?? `recon:${params.runType}:${crypto.randomUUID()}`
  const { data, error } = await db.from('reconciliation_runs').insert({
    run_reference: runReference,
    run_type: params.runType,
    environment: params.environment,
    source_reference: params.sourceReference ?? null,
    status: params.status ?? 'RUNNING',
    summary: params.summary ?? {},
    created_by: params.createdBy ?? null,
  }).select('*').single()

  if (error) throw new Error(`createReconciliationRun failed: ${error.message}`)
  return data as ReconciliationRunRecord
}

export async function updateReconciliationRun(db: DB, params: {
  runId: string
  status?: ReconciliationRunStatus
  summary?: Record<string, unknown>
  completedAt?: string | null
}): Promise<ReconciliationRunRecord> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (params.status) updates.status = params.status
  if (params.summary) updates.summary = params.summary
  if (params.completedAt !== undefined) updates.completed_at = params.completedAt

  const { data, error } = await db.from('reconciliation_runs')
    .update(updates)
    .eq('id', params.runId)
    .select('*')
    .single()

  if (error) throw new Error(`updateReconciliationRun failed: ${error.message}`)
  return data as ReconciliationRunRecord
}

export async function recordReconciliationDiscrepancy(db: DB, params: {
  reconciliationRunId: string
  entityType: string
  internalReference: string
  providerReference?: string | null
  expectedAmountKobo: number
  actualAmountKobo: number
  currency?: string
  environment: 'test' | 'production'
  severity: ReconciliationSeverity
  status?: ReconciliationDiscrepancyStatus
  investigationNotes?: string | null
  repairJournalId?: string | null
  resolver?: string | null
  resolvedAt?: string | null
}): Promise<ReconciliationDiscrepancyRecord> {
  const { data, error } = await db.from('reconciliation_discrepancies').insert({
    reconciliation_run_id: params.reconciliationRunId,
    entity_type: params.entityType,
    internal_reference: params.internalReference,
    provider_reference: params.providerReference ?? null,
    expected_amount_kobo: params.expectedAmountKobo,
    actual_amount_kobo: params.actualAmountKobo,
    currency: params.currency ?? 'NGN',
    environment: params.environment,
    severity: params.severity,
    status: params.status ?? 'OPEN',
    investigation_notes: params.investigationNotes ?? null,
    repair_journal_id: params.repairJournalId ?? null,
    resolver: params.resolver ?? null,
    resolved_at: params.resolvedAt ?? null,
  }).select('*').single()

  if (error) throw new Error(`recordReconciliationDiscrepancy failed: ${error.message}`)
  return data as ReconciliationDiscrepancyRecord
}

