import 'server-only'
import crypto from 'node:crypto'

// ─── WhatsApp Cloud API client (server-only) ─────────────────────────────────
// WHATSAPP_TOKEN and the Supabase service-role key are server-only secrets — this
// module is `server-only` so an accidental client import is a build error.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'

// Read at REQUEST TIME (not cached at module load) so a redeploy/env change is
// picked up without a cold-start race. Return null on missing so postMessage can
// log a clear, actionable error instead of throwing an opaque one.
function phoneNumberId(): string | null {
  return process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null
}
function token(): string | null {
  // trim() also strips a stray leading BOM/whitespace some shells prepend, which
  // would otherwise corrupt the Authorization header and yield a 190/401.
  return process.env.WHATSAPP_TOKEN?.trim() || null
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the RAW request body.
 * `signatureHeader` is the full header value ("sha256=<hex>"). Constant-time
 * compare via crypto.timingSafeEqual. Returns false (never throws) on any
 * malformed input so the caller just answers 401.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret || !signatureHeader) return false
  const expected = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader
  const computed = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  // Both hex strings of equal length → safe to timing-compare. Guard length
  // first because timingSafeEqual throws on unequal-length buffers.
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

type GraphResult = { ok: boolean; id?: string; error?: string }

// Meta error envelope (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes).
type GraphError = {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  error_data?: { details?: string }
  fbtrace_id?: string
}
type GraphResponse = { messages?: Array<{ id: string }>; error?: GraphError }

async function postMessage(payload: Record<string, unknown>): Promise<GraphResult> {
  const pnid = phoneNumberId()
  const tok = token()

  // Guard: missing config → log a clear, actionable error rather than failing
  // silently (or throwing an opaque "is not set" deep in the stack).
  if (!tok) {
    console.error('[whatsapp] WHATSAPP_TOKEN is missing/empty — cannot send. Set it in the Vercel env and redeploy.')
    return { ok: false, error: 'WHATSAPP_TOKEN missing' }
  }
  if (!pnid) {
    console.error('[whatsapp] WHATSAPP_PHONE_NUMBER_ID is missing/empty — cannot send. Set it in the Vercel env and redeploy.')
    return { ok: false, error: 'WHATSAPP_PHONE_NUMBER_ID missing' }
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pnid}/messages`
  const requestBody = { messaging_product: 'whatsapp', ...payload }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    // Read the raw text first so we can log it verbatim even if it isn't JSON.
    const rawText = await res.text()
    let json: GraphResponse = {}
    try { json = JSON.parse(rawText) as GraphResponse } catch { /* non-JSON body */ }

    if (!res.ok || json.error) {
      const e = json.error
      // FULL error surface in the logs: HTTP status + Meta code/subcode + message
      // + details + fbtrace_id, plus the message type we tried to send. This is
      // the line to grep for in Vercel after a failed reply.
      console.error('[whatsapp] send FAILED', JSON.stringify({
        httpStatus: res.status,
        code: e?.code,
        subcode: e?.error_subcode,
        message: e?.message,
        details: e?.error_data?.details,
        type: e?.type,
        fbtrace_id: e?.fbtrace_id,
        sentType: (payload as { type?: string }).type,
        to: (payload as { to?: string }).to,
        rawBody: rawText.slice(0, 1000),
      }))
      const code = e?.code != null ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : ''
      return { ok: false, error: `${e?.message || `HTTP ${res.status}`}${code}` }
    }

    return { ok: true, id: json.messages?.[0]?.id }
  } catch (err) {
    // Network/transport failure (DNS, timeout, TLS) — log with context.
    console.error('[whatsapp] send THREW', {
      error: err instanceof Error ? err.message : String(err),
      sentType: (payload as { type?: string }).type,
      to: (payload as { to?: string }).to,
    })
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

// Truncate by CODE POINT, not UTF-16 unit, so an emoji is never split into a
// lone surrogate (which Meta rejects with code 100 "invalid parameter").
function clamp(s: string, max: number): string {
  const cps = Array.from(s)
  return cps.length <= max ? s : cps.slice(0, max).join('')
}

/** Send a plain text message to a WhatsApp number (E.164 with or without +). */
export function sendText(to: string, body: string): Promise<GraphResult> {
  return postMessage({
    to: to.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: false, body: clamp(body, 4096) },
  })
}

export type WAButton = { id: string; title: string }

/**
 * Interactive reply buttons. WhatsApp hard limits: ≤3 buttons, title ≤20 chars,
 * id ≤256 chars. We clamp to those so a too-long title can never fail the send.
 */
export function sendButtons(to: string, body: string, buttons: WAButton[], header?: string): Promise<GraphResult> {
  const action = {
    buttons: buttons.slice(0, 3).map((b) => ({
      type: 'reply',
      reply: { id: b.id.slice(0, 256), title: clamp(b.title, 20) },
    })),
  }
  return postMessage({
    to: to.replace(/^\+/, ''),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: clamp(header, 60) } } : {}),
      body: { text: clamp(body, 1024) },
      action,
    },
  })
}

export type WARow = { id: string; title: string; description?: string }

/**
 * Interactive list. WhatsApp hard limits: ≤10 rows total, row title ≤24 chars,
 * description ≤72 chars, button label ≤20 chars. Rows are clamped to 10.
 */
export function sendList(
  to: string,
  body: string,
  buttonLabel: string,
  rows: WARow[],
  sectionTitle = 'Options',
): Promise<GraphResult> {
  return postMessage({
    to: to.replace(/^\+/, ''),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body.slice(0, 1024) },
      action: {
        button: clamp(buttonLabel, 20),
        sections: [
          {
            title: clamp(sectionTitle, 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: clamp(r.title, 24),
              ...(r.description ? { description: clamp(r.description, 72) } : {}),
            })),
          },
        ],
      },
    },
  })
}
