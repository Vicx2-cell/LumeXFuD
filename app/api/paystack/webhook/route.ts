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
  const reference = (data?.reference as string) ?? (data?.transfer_code as string) ?? ''

  // 4. Check idempotency — return 200 if already processed
  const db = createSupabaseAdmin()
  try {
    await db.from('processed_webhooks').insert({
      reference,
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
