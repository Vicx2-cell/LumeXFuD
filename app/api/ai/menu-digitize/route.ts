import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { getFeature } from '@/lib/features'
import { MENU_DIGITIZER_PROMPT, wrapUntrusted } from '@/lib/ai/prompts'
import { MenuDigest, parseModelJson } from '@/lib/ai/schemas'
import { aiUserRateLimit, recordLlmCall, CircuitBreaker } from '@/lib/ai/guard'
import {
  resolveProviderForRequest,
  isAIAvailable,
  type LLMRequest,
  type LLMImage,
  type LLMAudio,
} from '@/lib/ai/providers'

export const runtime = 'nodejs'

// Vendor Menu Digitizer — turns a PHOTO of a menu OR a spoken VOICE NOTE into the
// structured MenuDigest JSON the vendor reviews before saving. Provider-neutral:
// it runs on whichever provider AI_PROVIDER_MENU selects (Anthropic by default),
// EXCEPT a request carrying audio is force-routed to Gemini (Anthropic can't read
// raw audio). Output always goes through the existing Zod pipeline: parse → one
// retry → deterministic fallback, so a bad model reply never crashes onboarding.

const ALLOWED_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// Gemini's inline audio mime types.
const ALLOWED_AUDIO = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/aiff']

const MAX_IMAGES = 8
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB per photo
// Total inline payload cap. Gemini's inline request limit is ~20MB; stay clear of
// it so a voice note + photos never blow the request.
const MAX_TOTAL_BYTES = 18 * 1024 * 1024

// Tripped open after repeated model failures; fails open without Redis.
const breaker = new CircuitBreaker('menu-digitize', { threshold: 5, cooldownSeconds: 120, windowSeconds: 120 })

/** Approximate decoded byte size of a base64 string (without allocating it). */
function approxBytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4)
}

interface MediaIn { mimeType?: string; base64?: string }

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  // Per-vendor rate limit (matches the other vendor AI routes).
  const rl = await aiUserRateLimit(`menu-digitize:${session.userId ?? session.phone}`, 10, 300)
  if (!rl.success) return NextResponse.json({ error: 'Slow down a moment and try again.' }, { status: 429 })

  let body: { images?: MediaIn[]; image?: MediaIn; audio?: MediaIn[]; note?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  // ── Validate images ────────────────────────────────────────────────────────
  const rawImages = [...(body.images ?? []), ...(body.image ? [body.image] : [])]
  if (rawImages.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Too many photos (max ${MAX_IMAGES}).` }, { status: 400 })
  }
  const images: LLMImage[] = []
  for (const m of rawImages) {
    if (!m?.base64 || !m.mimeType) return NextResponse.json({ error: 'Each photo needs base64 data and a mimeType.' }, { status: 400 })
    if (!ALLOWED_IMG.includes(m.mimeType)) return NextResponse.json({ error: 'Photos must be JPG, PNG, WebP, or GIF.' }, { status: 400 })
    if (approxBytes(m.base64) > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'A photo is too large (max 5MB each).' }, { status: 400 })
    images.push({ base64: m.base64, mimeType: m.mimeType })
  }

  // ── Validate audio (voice note) ──────────────────────────────────────────────
  const rawAudio = body.audio ?? []
  const audio: LLMAudio[] = []
  for (const m of rawAudio) {
    if (!m?.base64 || !m.mimeType) return NextResponse.json({ error: 'Each voice note needs base64 data and a mimeType.' }, { status: 400 })
    if (!ALLOWED_AUDIO.includes(m.mimeType)) {
      return NextResponse.json({ error: 'Voice notes must be MP3, WAV, OGG, AAC, FLAC, or AIFF.' }, { status: 400 })
    }
    audio.push({ base64: m.base64, mimeType: m.mimeType })
  }

  if (images.length === 0 && audio.length === 0) {
    return NextResponse.json({ error: 'Add a photo of the menu or a voice note describing it.' }, { status: 400 })
  }

  // Total inline payload cap — keep well under the provider's inline limit. Voice
  // notes must be short.
  const totalBytes = [...images, ...audio].reduce((s, m) => s + approxBytes(m.base64), 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: 'Upload is too large. Keep voice notes short (under ~1 minute) and photos small.' },
      { status: 400 }
    )
  }

  // ── AI availability ──────────────────────────────────────────────────────────
  // Master `ai` kill switch first (cost guard, both providers).
  if (!(await getFeature('ai').catch(() => false))) {
    return NextResponse.json({ error: 'AI is not configured yet.' }, { status: 503 })
  }
  // Audio forces Gemini; without a Gemini key voice can't run.
  if (audio.length > 0 && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'Voice menus need Gemini configured. Add a photo instead, or contact support.' }, { status: 503 })
  }
  // Photo path is pinned to Anthropic (never the free tier — a menu photo could be
  // an ID card). Without an Anthropic key the photo path can't run safely.
  if (audio.length === 0 && images.length > 0 && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Photo menus need our secure AI provider configured. Contact support.' }, { status: 503 })
  }
  // Text-only path: the active provider must be usable.
  if (audio.length === 0 && images.length === 0 && !(await isAIAvailable('menu'))) {
    return NextResponse.json({ error: 'AI is not configured yet.' }, { status: 503 })
  }

  // Circuit breaker + global hourly LLM budget.
  if (!(await breaker.canPass())) {
    return NextResponse.json({ error: 'The menu reader is resting after some errors — try again shortly.' }, { status: 503 })
  }
  const cap = await recordLlmCall()
  if (!cap.allowed) return NextResponse.json({ error: 'AI is at capacity right now — try again shortly.' }, { status: 429 })

  const note = (body.note ?? '').trim().slice(0, 300)
  const baseUserText = `Read this vendor's menu and output the JSON schema.${note ? `\nVendor note: ${wrapUntrusted(note)}` : ''}`

  // Capability-aware provider choice: audio → Gemini regardless of env.
  const baseReq: LLMRequest = { system: MENU_DIGITIZER_PROMPT, userText: baseUserText, images, audio, jsonMode: true, maxTokens: 4096 }
  let provider
  try {
    provider = await resolveProviderForRequest(baseReq, 'menu')
  } catch {
    return NextResponse.json({ error: 'The menu reader is not available for this request right now.' }, { status: 503 })
  }

  // ── Parse → one retry → deterministic fallback (existing Zod pipeline) ────────
  let digest: MenuDigest | null = null
  let usedProvider: 'anthropic' | 'gemini' = 'anthropic'
  let usedModel = ''
  let lastError = ''
  try {
    for (let attempt = 0; attempt < 2 && !digest; attempt++) {
      const userText = attempt === 0
        ? baseUserText
        : `${baseUserText}\n\nYour previous reply could not be used (${lastError}). Return ONLY valid JSON that matches the schema — no prose, no markdown.`
      const out = await provider.generate({ ...baseReq, userText })
      usedProvider = out.provider
      usedModel = out.model
      const parsed = parseModelJson(MenuDigest, out.text)
      if (parsed.ok) digest = parsed.data
      else lastError = parsed.error
    }
    await breaker.recordSuccess()
  } catch (err) {
    console.error('[ai/menu-digitize] error:', err)
    await breaker.recordFailure()
  }

  if (!digest) {
    // Fallback: never block onboarding on AI — let the vendor add items by hand.
    return NextResponse.json({
      digest: { items: [], unreadable_sections: ['Automatic reading failed — please add your menu items manually.'] } satisfies MenuDigest,
      provider: usedProvider,
      model: usedModel,
      fell_back: true,
    })
  }

  return NextResponse.json({ digest, provider: usedProvider, model: usedModel, fell_back: false })
}
