import { NextRequest, NextResponse } from 'next/server'
import { verifyHMAC } from '@/lib/security'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { processWebhookAsync, type PaystackWebhookPayload } from '@/lib/paystack/webhook'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // 1. READ raw body BEFORE parsing JSON (HMAC needs raw bytes)
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET ?? ''

  // 2. Verify HMAC — reject 400 if invalid
  if (!secret || !verifyHMAC(rawBody, signature, secret)) {
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

  // 4. Check idempotency — return 200 if already processed
  const db = createSupabaseAdmin()
  try {
    await db.from('processed_webhooks').insert({
      reference: dedupeRef,
      event,
      payload,
    })
  } catch {
    // UNIQUE constraint violation = already processed
    return new NextResponse(null, { status: 200 })
  }

  // 5. Return 200 to Paystack IMMEDIATELY (within 30s requirement)
  // 6. Process async — do not await
  void processWebhookAsync(payload).catch((err: unknown) => {
    console.error('[webhook] async processing error:', err)
  })

  return new NextResponse(null, { status: 200 })
}
