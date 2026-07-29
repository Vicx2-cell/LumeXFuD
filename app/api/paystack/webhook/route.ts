import { NextRequest, NextResponse } from 'next/server'
import { verifyHMAC } from '@/lib/security'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { recordSecurityEvent } from '@/lib/security-events'
import { processWebhookAsync, type PaystackWebhookPayload } from '@/lib/paystack/webhook'
import { evaluateRisk } from '@/lib/risk-engine'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

const clientIp = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const requestContext = createRequestContext(req.headers)
  const respond = (body: unknown, status: number) => applyRequestContext(
    body === null ? new NextResponse(null, { status }) : NextResponse.json(body, { status }),
    requestContext,
  )
  const eventContext = {
    ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? undefined,
    requestId: requestContext.requestId, correlationId: requestContext.correlationId,
    route: req.nextUrl.pathname, method: req.method,
  }
  // ⚠️ NEVER gate this route on a system control / kill switch (LumeX Control
  // spec). Reconciliation MUST always run — even in `maintenance`, `paused`, or
  // when payouts are `frozen` — because customers may have ALREADY paid for
  // in-flight orders and Paystack will keep retrying until we 200. Adding a flag
  // that can switch this off would strand paid orders and break wallet
  // reconciliation. Do not "helpfully" add one.

  // 1. READ raw body BEFORE parsing JSON (HMAC needs raw bytes)
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''

  // 2. Verify HMAC — reject 400 if invalid.
  //
  // Paystack signs every webhook with HMAC-SHA512 using your account's SECRET
  // KEY (sk_live_… / sk_test_…) — there is NO separate "webhook secret" in
  // Paystack's model. We therefore verify against PAYSTACK_SECRET_KEY (which is
  // already proven correct in prod because transaction initialization uses it).
  // No additional signing key is accepted: a stale secondary secret would
  // unnecessarily expand the trust boundary for payment events.
  const signingSecret = process.env.PAYSTACK_SECRET_KEY
  const signatureOk = Boolean(signingSecret && verifyHMAC(rawBody, signature, signingSecret))
  if (!signatureOk) {
    console.warn('[webhook] invalid Paystack signature')
    // DETECT: a forged/garbled signature is a critical security event.
    await recordSecurityEvent({
      eventType: 'webhook_reject', severity: 'critical', surface: 'paystack_webhook',
      ...eventContext, outcome: 'rejected', detail: { reason: 'bad_signature' },
    })
    return respond({ error: 'Invalid signature' }, 400)
  }

  // 3. Parse body
  let payload: PaystackWebhookPayload
  try {
    payload = JSON.parse(rawBody) as PaystackWebhookPayload
  } catch {
    return respond({ error: 'Invalid JSON' }, 400)
  }

  const { event, data } = payload

  // Idempotency key. processed_webhooks is UNIQUE(reference, event), so this
  // string only needs to be stable across Paystack's retries of the SAME event
  // and distinct between different resources of the same event type.
  //
  // The old `data.reference ?? data.transfer_code` chain returned '' for events
  // that carry their id elsewhere — refund.processed / refund.failed put it in
  // `transaction_reference` / `id`, never `reference`. Every such event then
  // collapsed to ('', 'refund.processed'): the first was recorded and ALL later
  // ones hit the unique constraint and were silently dropped as "already
  // processed", so refund status updates after the first never applied.
  //
  // Paystack stamps a unique resource `id` on every event's data object
  // (transaction / transfer / refund id), so prefer it; fall back to the
  // human-readable refs for older/edge payloads. `||` (not `??`) so an empty
  // string also falls through.
  const dedupeRef =
    (data?.id != null ? String(data.id) : '') ||
    (data?.reference as string) ||
    (data?.transfer_code as string) ||
    (data?.transaction_reference as string) ||
    (data?.refund_reference as string) ||
    ''

  // 4. Check idempotency — return 200 if already processed.
  //
  // IMPORTANT: supabase-js does NOT throw on a unique-constraint violation — it
  // RESOLVES with `{ error }` (Postgres code 23505). The previous try/catch only
  // caught genuinely-thrown (network) errors, so a duplicate insert fell through
  // and re-ran processWebhookAsync on every Paystack retry. We now inspect the
  // returned error: 23505 means this (reference, event) is already recorded —
  // stop and 200. Any other insert error is logged but NOT fatal (the downstream
  // handlers are themselves idempotent), so a transient DB hiccup can't strand a
  // genuinely-paid order.
  const db = createSupabaseAdmin()
  try {
    // NOTE: production's processed_webhooks has drifted from migration 007 and
    // carries an extra `paystack_reference NOT NULL` column (created out-of-band,
    // not in any migration). Writing only `reference` therefore failed the NOT
    // NULL constraint on every webhook, so idempotency was never recorded. Set
    // both columns to the same dedupe value so the insert succeeds and the
    // (reference,event) / (paystack_reference,event) uniqueness drives dedup.
    const { error: insErr } = await db.from('processed_webhooks').insert({
      reference: dedupeRef,
      paystack_reference: dedupeRef,
      event,
      payload,
    })
    if (insErr) {
      if (insErr.code === '23505') {
        const risk = evaluateRisk([{
          code: 'payment_webhook_duplicate', category: 'payment', weight: 12,
          confidence: 0.5, strength: 'weak',
        }])
        await recordSecurityEvent({
          eventType: 'webhook_replay', severity: 'info', surface: 'paystack_webhook',
          ...eventContext, outcome: 'duplicate_ignored',
          resourceType: 'paystack_event', resourceId: dedupeRef || undefined,
          detail: { event, risk },
        })
        return respond(null, 200)
      }
      // FAIL CLOSED (root-cause fix). The old code logged this and CONTINUED to
      // process — so if the idempotency key could not be recorded, the money
      // handlers ran with NO replay guard and every Paystack retry re-ran them
      // (double-booked subscriptions/earnings). Now: if we cannot record the
      // dedup key, we do NOT process. Return non-2xx so Paystack retries; once
      // the insert may succeed and we process exactly once. Same fail-closed
      // principle as isSessionLive (#2).
      console.error('[webhook] processed_webhooks insert error (NOT processing):', insErr.message)
      await recordSecurityEvent({
        eventType: 'webhook_reject', severity: 'warn', surface: 'paystack_webhook',
        ...eventContext, outcome: 'deferred', detail: { reason: 'dedup_record_failed', event, code: insErr.code },
      })
      return respond({ error: 'Webhook processing deferred' }, 503)
    }
  } catch {
    // A network error recording the replay guard also defers processing.
    return respond({ error: 'Webhook processing deferred' }, 503)
  }

  // Process within the provider response window. Acknowledgement is withheld
  // until the idempotent money handler has completed.
  try {
    await processWebhookAsync(payload)
  } catch (err) {
    const { error: releaseError } = await db.from('processed_webhooks')
      .delete()
      .eq('reference', dedupeRef)
      .eq('event', event)
    if (releaseError) {
      console.error('[webhook] failed to release failed processing claim:', releaseError.message)
    }
    console.error('[webhook] processing error:', err)
    await recordSecurityEvent({
      eventType: 'webhook_reject', severity: 'critical', surface: 'paystack_webhook',
      ...eventContext, outcome: 'processing_failed',
      resourceType: 'paystack_event', resourceId: dedupeRef || undefined,
      detail: { event, claimReleased: !releaseError },
    })
    return respond({ error: 'Webhook processing failed' }, 500)
  }

  return respond(null, 200)
}
