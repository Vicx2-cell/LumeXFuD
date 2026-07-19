import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createLumiContext, processLumiMessage } from '@/lib/lumi/actions'
import { matchIntent } from '@/lib/lumi/intents'
import { clearState, getState, setState } from '@/lib/lumi/state'
import { LUMI_MAX_MESSAGE_LENGTH } from '@/lib/lumi/types'
import { isSecuritySensitiveMessage } from '@/lib/lumi/local-intelligence'
import { redactPII } from '@/lib/ai/guard'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  message: z.string().trim().min(1).max(LUMI_MAX_MESSAGE_LENGTH),
})

function sanitizeForLogging(message: string): string {
  return redactPII(message)
    .replace(/\b\d{12,19}\b/g, '[redacted-number]')
    .slice(0, LUMI_MAX_MESSAGE_LENGTH)
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'customer') {
    return NextResponse.json({ error: 'Lumi is available for customer accounts only.' }, { status: 403 })
  }

  const limiterKey = `lumi:${session.userId ?? session.phone}`
  const rl = await rateLimitGeneric(limiterKey, 20, 60)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many chat requests. Please wait a moment and try again.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Message is required and must be short.' }, { status: 400 })
  }

  const ctx = await createLumiContext(session)
  if (!ctx) {
    return NextResponse.json({ error: 'Customer profile not found.' }, { status: 404 })
  }

  const state = await getState(ctx.customerId)

  try {
    const result = await processLumiMessage(ctx, parsed.data.message, state)

    if (result.clearState) {
      await clearState(ctx.customerId)
    } else if (result.nextState) {
      await setState(ctx.customerId, result.nextState)
    }

    const intentResult = matchIntent(parsed.data.message)
    if (intentResult.intent === 'fallback' && parsed.data.message.trim() && !isSecuritySensitiveMessage(parsed.data.message)) {
      const db = createSupabaseAdmin()
      db.from('lumi_unmatched_messages')
        .insert({
          user_id: ctx.customerId,
          message: sanitizeForLogging(parsed.data.message),
          normalized_message: sanitizeForLogging(intentResult.normalizedMessage),
          active_step: state?.step ?? null,
        })
        .then(() => {}, (error) => {
          console.error('[lumi] unmatched logging failed:', error)
        })
    }

    return NextResponse.json(result.response)
  } catch (error) {
    console.error('[lumi] route error:', error)
    await clearState(ctx.customerId)
    return NextResponse.json({
      reply: 'Something went wrong. Please try again.',
      quickReplies: [{ id: 'help', label: 'Help', value: 'help' }],
    }, { status: 500 })
  }
}
