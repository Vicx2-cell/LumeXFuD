import 'server-only'

import type { createSupabaseAdmin } from './supabase/server'
import { recordOrderStatusEvent } from './location-intelligence'
import { sendOrderStatusEmail, type TransactionalEmailResult } from './transactional-email'

type DB = ReturnType<typeof createSupabaseAdmin>

/** Records the durable status event, then sends its customer email best-effort. */
export async function emailCommittedOrderStatus(db: DB, input: {
  orderId: string
  status: string
  actorType: string
  actorId: string
  latitude?: number | null
  longitude?: number | null
  gpsAccuracy?: number | null
  distanceFromExpectedMeters?: number | null
  validationStatus?: string
}): Promise<TransactionalEmailResult> {
  const statusEventId = crypto.randomUUID()
  try {
    await recordOrderStatusEvent(db, {
      eventId: statusEventId,
      orderId: input.orderId,
      actorType: input.actorType,
      actorId: input.actorId,
      status: input.status,
      latitude: input.latitude,
      longitude: input.longitude,
      gpsAccuracy: input.gpsAccuracy,
      distanceFromExpectedMeters: input.distanceFromExpectedMeters,
      validationStatus: input.validationStatus,
    })
  } catch {
    // Status is already committed. Audit/event failure must not change that fact.
  }
  try {
    return await sendOrderStatusEmail(db, { orderId: input.orderId, newStatus: input.status, statusEventId })
  } catch {
    return { ok: false, status: 'failed', workflow: 'delivery_status', providerMessageId: null, attempts: 0, errorCode: 'status_email_error', retryable: false }
  }
}
