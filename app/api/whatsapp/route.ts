import { NextRequest, NextResponse } from 'next/server'
import { verifySignature } from '@/lib/whatsapp'
import { handleInbound, logInboundOnce, type InboundMessage } from '@/lib/whatsapp-handler'
import { getFeature } from '@/lib/features'

// MUST run on Node (uses node:crypto for the HMAC + the Supabase service-role
// client). Edge has no Node crypto and must never see the service-role key.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── GET: Meta webhook verification handshake ────────────────────────────────
// Meta calls GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// Return the challenge as PLAIN TEXT 200 when the token matches.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const verifyToken = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode === 'subscribe' && verifyToken && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ─── POST: inbound messages ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1) Read the RAW body and verify the HMAC BEFORE parsing JSON.
  const raw = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  if (!verifySignature(raw, signature)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  // 2) Master kill switch: when the `whatsapp_bot` feature flag is OFF, ACK Meta
  // with 200 (so it never retries or disables the webhook) but do NOT process or
  // reply to anything. This lets the platform ship with the bot dark and flip it
  // on later from /super-admin/features — no redeploy needed.
  if (!(await getFeature('whatsapp_bot'))) {
    return NextResponse.json({ received: true, bot: 'disabled' })
  }

  // 3) Parse only after the signature passes.
  let body: WebhookBody
  try {
    body = JSON.parse(raw) as WebhookBody
  } catch {
    return new NextResponse('Bad JSON', { status: 400 })
  }

  // 4) Walk the payload, ignoring status callbacks / other change types gracefully.
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value
        const message = value?.messages?.[0]
        if (!message) continue // status callbacks, read receipts, etc. → ignore

        const inbound = extractMessage(value, message)
        if (!inbound) continue

        // Dedupe on Meta's message id (it retries). Only process first-seen ones.
        const fresh = await logInboundOnce(inbound)
        if (!fresh) continue

        // Process INLINE before returning — Vercel kills work after the response,
        // so fire-and-forget would drop replies.
        await handleInbound(inbound)
      }
    }
  } catch (err) {
    // Never 500 to Meta (it would retry forever). Log and 200.
    console.error('[whatsapp] handler error', err)
  }

  // 4) Always 200 fast so Meta stops retrying.
  return NextResponse.json({ received: true })
}

// ─── Payload typing + extraction ─────────────────────────────────────────────
type WAMessage = {
  id: string
  from: string
  type: string
  text?: { body?: string }
  interactive?: {
    type?: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
  button?: { text?: string; payload?: string }
  location?: { latitude?: number; longitude?: number }
}

type WAValue = {
  messages?: WAMessage[]
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
}

type WebhookBody = {
  entry?: Array<{ changes?: Array<{ value?: WAValue }> }>
}

function extractMessage(value: WAValue, m: WAMessage): InboundMessage | null {
  const profileName = value.contacts?.[0]?.profile?.name
  const base = { waMessageId: m.id, from: m.from, rawType: m.type, profileName, raw: m as unknown }

  switch (m.type) {
    case 'text':
      return { ...base, text: m.text?.body ?? '' }
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply
      if (!r) return null
      return { ...base, replyId: r.id, text: r.title }
    }
    case 'button':
      // Template quick-reply buttons carry their payload here.
      return { ...base, replyId: m.button?.payload ?? m.button?.text ?? '', text: m.button?.text ?? '' }
    case 'location': {
      const lat = m.location?.latitude
      const lng = m.location?.longitude
      if (typeof lat === 'number' && typeof lng === 'number') return { ...base, location: { latitude: lat, longitude: lng } }
      return { ...base, text: '' }
    }
    default:
      // images/audio/etc. → treat as a nudge back to the menu.
      return { ...base, text: '' }
  }
}
