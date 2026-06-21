import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { isAIAvailable, resolveProvider } from '@/lib/ai/providers'
import { BADGE_MEANINGS } from '@/lib/badges'
import { getCurrentUser } from '@/lib/session'
import { recordLlmCall } from '@/lib/ai/guard'

// Lumi explains a badge in her own warm voice. Grounded in the static catalog
// meaning so she never invents a rule. Cached per badge (not per user) since the
// explanation is the same for everyone — cheap, and snappy on tap. AI is
// garnish: with no key / on any error we return the plain description.
export const dynamic = 'force-dynamic'

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

// Lumi's persona, trimmed to the badge-explainer job (mirrors /api/chow-ai).
const SYSTEM = `You are "Lumi", a warm, friendly companion inside LumeX Fud, a campus food delivery app at Abia State University, Nigeria. A student just tapped one of their achievement badges to learn what it means. In 1–2 short, warm sentences, tell them what the badge celebrates and (lightly) how to earn or keep it — like a proud friend. Natural English, no heavy pidgin. At most one emoji. Use ONLY the facts given; never invent rules or numbers. Output ONLY the explanation, no quotes.`

export async function GET(req: NextRequest) {
  // Require a session: this triggers a paid LLM call, so it must not be an open,
  // unauthenticated cost vector. Any logged-in role may read a badge meaning.
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id') ?? ''
  const meaning = BADGE_MEANINGS[id]
  if (!meaning) return NextResponse.json({ text: null }, { status: 404 })

  const fallback = meaning.description
  if (!(await isAIAvailable('lumi'))) return NextResponse.json({ text: fallback })

  const key = `lumi:badge:${id}`
  const r = redis()
  try {
    if (r) {
      const cached = await r.get<string>(key)
      if (cached) return NextResponse.json({ text: cached })
    }
    // Count this against the global hourly LLM budget (cache misses only). Over
    // budget → serve the plain description rather than spend.
    const cap = await recordLlmCall()
    if (!cap.allowed) return NextResponse.json({ text: fallback })
    const provider = await resolveProvider('lumi')
    const res = await provider.generate({
      maxTokens: 90,
      system: SYSTEM,
      userText: `Badge: ${meaning.name} ${meaning.emoji}\nWhat it celebrates: ${meaning.description}\nHow it's earned: ${meaning.howto}`,
    })
    const text = res.text.trim().replace(/^["']|["']$/g, '')
    const out = text ? text.slice(0, 220) : fallback
    if (r && text) await r.set(key, out, { ex: 7 * 24 * 3600 })
    return NextResponse.json({ text: out })
  } catch {
    return NextResponse.json({ text: fallback })
  }
}
