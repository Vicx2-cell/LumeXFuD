import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, MODELS } from './ai/client'
import { getFeature } from './features'
import type { IngestProgramme } from './study-ingest'

// Server-only: the grounded model call + the AI kill switch. Never imported by
// client code; the API key stays server-side (getAnthropic reads process.env).

/**
 * AI kill switch (§7.5). Off disables ALL study AI with no code change:
 *  - the `study` super-admin flag being off (no redeploy), OR
 *  - STUDY_AI_ENABLED=false in the environment.
 */
export async function studyAiEnabled(): Promise<boolean> {
  if (process.env.STUDY_AI_ENABLED === 'false') return false
  return getFeature('study')
}

// Ingestion is a low-volume, accuracy-critical one-time job, so it uses the
// stronger (Sonnet) model — NOT the cheap per-student tier. Override via env.
const INGEST_MODEL = process.env.AI_MODEL_INGEST || MODELS.vision

const SYSTEM = `You extract Nigerian university curriculum data, grounded in the official NUC CCMAS (Core Curriculum and Minimum Academic Standards, in force since Sept 2023). Use web search to find the CCMAS document for the requested programme/discipline.

For each course a student should offer, output: code, title, level (100|200|300|400|500), semester (1|2), creditUnits (number), kind ("core"|"elective"), evidence, sourceUrl, confidence (0..1).

"evidence" is how well-sourced the row is:
- "national_core": the course appears in the published CCMAS document (applies nationally).
- "multi_source": two or more independent sources agree exactly.
- "single_source": one source, or a weak/indirect source.
- "conflict": sources disagree.

RULES:
- NEVER invent a code, unit count, or semester to fill a gap. If unsure, give your best estimate, mark it "single_source" or "conflict", and lower the confidence — do not fabricate certainty.
- The ABSU-specific ~30% (exact codes/units/semester for a given school) cannot be verified online; mark those "single_source" or "conflict", never "national_core".
- Always include a sourceUrl you actually consulted for each row.
- Output ONLY JSON, no prose: {"courses":[ ... ]}`

/** Calls the grounded model and returns its raw JSON text. Returns '' if no key. */
export async function runExtraction(programme: IngestProgramme): Promise<string> {
  const anthropic = getAnthropic()
  if (!anthropic) return ''

  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }] as unknown as Anthropic.Messages.ToolUnion[]
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content: `Programme: ${programme.name} (College of ${programme.facultyName}), Abia State University (ABSU), Nigeria. Extract its CCMAS curriculum across all levels and both semesters.`,
    },
  ]

  let res = await anthropic.messages.create({ model: INGEST_MODEL, max_tokens: 12000, system: SYSTEM, tools, messages })
  // Server-side web-search loop can pause_turn; re-send to resume (bounded).
  let guard = 0
  while (res.stop_reason === 'pause_turn' && guard++ < 10) {
    messages.push({ role: 'assistant', content: res.content })
    res = await anthropic.messages.create({ model: INGEST_MODEL, max_tokens: 12000, system: SYSTEM, tools, messages })
  }

  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  console.log(`[study-ingest] ${programme.id}: stop_reason=${res.stop_reason} continuations=${guard} textChars=${text.length}`)
  return text
}
