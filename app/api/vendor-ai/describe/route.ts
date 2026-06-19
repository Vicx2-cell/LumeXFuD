import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { trackFeature } from '@/lib/usage'
import { isAIAvailable, resolveProvider, type LLMImage } from '@/lib/ai/providers'
import { wrapUntrusted } from '@/lib/ai/prompts'

export const runtime = 'nodejs'

// "Invisible catalog polish" — drafts a short, appetizing menu description for a
// vendor's item. Grounded in the item's PHOTO (vision) when one exists, else from
// the name + category. The vendor reviews/edits before saving (human in control);
// this only fills the field. Money/prices never appear here.

const SYSTEM = `You write ONE short, appetizing menu description for a food/drink item on a Nigerian campus food app. Rules:
- Max 18 words, one sentence, plain natural English. No emoji, no markdown, no quotes.
- Make it mouth-watering but honest — describe the food itself (key ingredients, taste, portion feel).
- Keep local dish names as given (jollof, egusi, abacha, suya). Do not translate.
- NEVER mention price, "best", "delicious", "yummy", or marketing fluff. Show, don't boast.
- If a photo is provided, describe what is actually shown. Output ONLY the description text.`

const ALLOWED_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })
  trackFeature('vendor_ai', 'vendor')

  const rl = await rateLimitGeneric(`vendor-ai:describe:${session.userId ?? session.phone}`, 30, 300)
  if (!rl.success) return NextResponse.json({ error: 'Slow down a moment and try again.' }, { status: 429 })

  if (!(await isAIAvailable('menu'))) return NextResponse.json({ error: 'AI is not configured yet.' }, { status: 503 })

  let body: { name?: string; category?: string; image_url?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const name = (body.name ?? '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'Add the item name first.' }, { status: 400 })
  const category = (body.category ?? '').trim().slice(0, 40)

  // Try to ground the description in the item's photo (vision). Only fetch images
  // from our own Supabase storage to avoid SSRF via an attacker-supplied URL.
  const images: LLMImage[] = []
  const appHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').host } catch { return '' } })()
  if (body.image_url && appHost && (() => { try { return new URL(body.image_url!).host === appHost } catch { return false } })()) {
    try {
      const r = await fetch(body.image_url, { signal: AbortSignal.timeout(6000) })
      if (r.ok) {
        const ct = (r.headers.get('content-type') ?? 'image/webp').split(';')[0]
        const buf = Buffer.from(await r.arrayBuffer())
        if (ALLOWED_IMG.includes(ct) && buf.byteLength <= 3 * 1024 * 1024) {
          images.push({ base64: buf.toString('base64'), mimeType: ct })
        }
      }
    } catch { /* fall back to text-only */ }
  }

  const promptText = `Item name: ${wrapUntrusted(name)}${category ? `\nCategory: ${category}` : ''}\nWrite the description.`

  try {
    const provider = await resolveProvider('menu')
    const out = await provider.generate({ system: SYSTEM, userText: promptText, images, maxTokens: 80 })
    let text = out.text.trim()
    text = text.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 200)
    if (!text) return NextResponse.json({ error: 'Could not write a description. Try again.' }, { status: 502 })
    return NextResponse.json({ description: text, from_photo: images.length > 0 })
  } catch (err) {
    console.error('[vendor-ai/describe] error:', err)
    return NextResponse.json({ error: 'AI had a hiccup. Try again.' }, { status: 500 })
  }
}
