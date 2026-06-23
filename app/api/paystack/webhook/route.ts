import { NextRequest, NextResponse } from 'next/server'
import { verifyHMAC } from '@/lib/security'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { processWebhookAsync, type PaystackWebhookPayload } from '@/lib/paystack/webhook'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
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
  // PAYSTACK_WEBHOOK_SECRET is kept as an optional override/fallback for any
  // environment that deliberately configured a distinct value; a match on EITHER
  // is accepted. (Previously this checked ONLY PAYSTACK_WEBHOOK_SECRET, which was
  // unset/mismatched in prod, so EVERY real webhook failed signature and no paid
  // Paystack order ever finalized.)
  const candidateSecrets = [process.env.PAYSTACK_SECRET_KEY, process.env.PAYSTACK_WEBHOOK_SECRET]
    .filter((s): s is string => !!s)
  const signatureOk = candidateSecrets.some((s) => verifyHMAC(rawBody, signature, s))
  if (!signatureOk) {
    console.warn('[webhook] invalid Paystack signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // 3. Parse body
  let payload: PaystackWebhookPayload
  try {
    payload = JSON.parse(rawBody) as PaystackWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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
    const { error: insErr } = await db.from('processed_webhooks').insert({
      reference: dedupeRef,
      event,
      payload,
    })
    if (insErr) {
      if (insErr.code === '23505') return new NextResponse(null, { status: 200 })
      console.error('[webhook] processed_webhooks insert error (continuing):', insErr.message)
    }
  } catch {
    // Thrown (network) error recording the webhook — treat as already-processed
    // and let Paystack retry rather than risk double side effects this attempt.
    return new NextResponse(null, { status: 200 })
  }

  // 5. Return 200 to Paystack IMMEDIATELY (within 30s requirement)
  // 6. Process async — do not await
  void processWebhookAsync(payload).catch((err: unknown) => {
    console.error('[webhook] async processing error:', err)
  })

  return new NextResponse(null, { status: 200 })
}
