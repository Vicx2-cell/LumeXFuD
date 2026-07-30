import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { superAudit } from '@/lib/audit'
import { processWebhookAsync, type PaystackWebhookPayload } from '@/lib/paystack/webhook'

const replayInput = z.object({
  payload: z.object({
    event: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }).strict(),
  reason: z.string().trim().min(3).max(300),
  idempotency_key: z.string().trim().min(8).max(120),
  confirm: z.literal(true),
}).strict()

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate.error
  const session = gate.session

  const rl = await rateLimitGeneric(`super-admin-payments-replay:${session.userId ?? session.phone}`, 10, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsed = replayInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'payments_webhook_replay_requested',
    target_table: 'processed_webhooks',
    target_id: parsed.data.idempotency_key,
    new_value: { event: parsed.data.payload.event, reason: parsed.data.reason, confirm: true },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  await processWebhookAsync(parsed.data.payload as PaystackWebhookPayload)

  return NextResponse.json({ success: true, replayed: true })
}
