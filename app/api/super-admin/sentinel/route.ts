import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { gatherSnapshot, type SentinelSnapshot } from '@/lib/sentinel'
import { getAnthropic, MODELS } from '@/lib/ai/client'
import { parseModelJson, TriageBrief } from '@/lib/ai/schemas'
import { TRIAGE_PROMPT } from '@/lib/ai/prompts'

export const runtime = 'nodejs'

// The super-admin's "personal Sentry". Read-only platform health snapshot, plus
// an AI triage brief when something is wrong. Super-admin only — it can see
// across all the data, so the gate is strict.

async function triage(snapshot: SentinelSnapshot): Promise<TriageBrief | null> {
  const anthropic = await getAnthropic()
  if (!anthropic) return null
  const context = `LumeX Fud platform health snapshot:\n${JSON.stringify({ status: snapshot.status, metrics: snapshot.metrics, issues: snapshot.issues })}`
  try {
    const res = await anthropic.messages.create({
      model: MODELS.fast,
      max_tokens: 500,
      system: TRIAGE_PROMPT,
      messages: [{ role: 'user', content: context }],
    })
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const parsed = parseModelJson(TriageBrief, text)
    return parsed.ok ? parsed.data : null
  } catch (err) {
    console.error('[sentinel] triage failed:', err)
    return null
  }
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const snapshot = await gatherSnapshot(db)

  // Only spend an LLM call when there's something to explain (SEV1/SEV2).
  const needsTriage = snapshot.issues.some((i) => i.severity === 'SEV1' || i.severity === 'SEV2')
  const brief = needsTriage ? await triage(snapshot) : null

  return NextResponse.json({ snapshot, triage: brief })
}
