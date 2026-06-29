import 'server-only'
import crypto from 'node:crypto'

// ─── WhatsApp Cloud API client (server-only) ─────────────────────────────────
// WHATSAPP_TOKEN and the Supabase service-role key are server-only secrets — this
// module is `server-only` so an accidental client import is a build error.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not set')
  return id
}
function token(): string {
  const t = process.env.WHATSAPP_TOKEN
  if (!t) throw new Error('WHATSAPP_TOKEN is not set')
  return t
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

async function postMessage(payload: Record<string, unknown>): Promise<GraphResult> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId()}/messages`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>
      error?: { message?: string }
    }
    if (!res.ok) return { ok: false, error: json.error?.message || `HTTP ${res.status}` }
    return { ok: true, id: json.messages?.[0]?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

/** Send a plain text message to a WhatsApp number (E.164 with or without +). */
export function sendText(to: string, body: string): Promise<GraphResult> {
  return postMessage({
    to: to.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: false, body: body.slice(0, 4096) },
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
      reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
    })),
  }
  return postMessage({
    to: to.replace(/^\+/, ''),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
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
        button: buttonLabel.slice(0, 20),
        sections: [
          {
            title: sectionTitle.slice(0, 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  })
}
