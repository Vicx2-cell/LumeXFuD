import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { providerEventErrorCode, providerEventStatus } from '@/lib/email/provider-events'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!webhookSecret || !apiKey) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const payload = await req.text()
  let event: ReturnType<Resend['webhooks']['verify']>
  try {
    event = new Resend(apiKey).webhooks.verify({
      payload,
      headers: {
        id: req.headers.get('svix-id') ?? '',
        timestamp: req.headers.get('svix-timestamp') ?? '',
        signature: req.headers.get('svix-signature') ?? '',
      },
      webhookSecret,
    })
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  const status = providerEventStatus(event.type)
  if (!status || !('email_id' in event.data)) return NextResponse.json({ received: true })
  const now = new Date().toISOString()
  const { error } = await createSupabaseAdmin().rpc('record_email_provider_event', {
    p_resend_id: event.data.email_id,
    p_status: status,
    p_error_code: providerEventErrorCode(event.type),
    p_event_at: event.created_at || now,
  })
  if (error) {
    console.error('[email.provider_event_update_failed]', { type: event.type, code: error.code ?? 'database_error' })
    return NextResponse.json({ error: 'Persistence failed' }, { status: 500 })
  }
  console.info('[email.provider_event]', { type: event.type, providerMessageId: event.data.email_id })
  return NextResponse.json({ received: true })
}
