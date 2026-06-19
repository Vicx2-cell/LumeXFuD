import { resolveProvider } from './ai/providers'
import { getFeature } from './features'
import type { IngestProgramme } from './study-ingest'

// Server-only: the grounded model call + the AI kill switch. Never imported by
// client code; the provider keys stay server-side (read from process.env).

/**
 * AI kill switch (§7.5). Off disables ALL study AI with no code change:
 *  - the `study` super-admin flag being off (no redeploy), OR
 *  - STUDY_AI_ENABLED=false in the environment.
 */
export async function studyAiEnabled(): Promise<boolean> {
  if (process.env.STUDY_AI_ENABLED === 'false') return false
  return getFeature('ai') // master AI kill switch (super-admin)
}

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

/** Calls the grounded model and returns its raw JSON text. Returns '' if AI off. */
export async function runExtraction(programme: IngestProgramme): Promise<string> {
  if (!(await studyAiEnabled())) return ''

  // Web-grounded, single call. The provider handles grounding per engine:
  // Anthropic web_search (with its pause_turn resume loop) or Gemini Google
  // Search grounding — both run on the stronger vision-tier model.
  const userText = `Programme: ${programme.name} (College of ${programme.facultyName}), Abia State University (ABSU), Nigeria. Extract its CCMAS curriculum across all levels and both semesters.`
  try {
    const provider = await resolveProvider('study')
    const out = await provider.generate({ system: SYSTEM, userText, webSearch: true, maxTokens: 12000 })
    console.log(`[study-ingest] ${programme.id}: provider=${out.provider} model=${out.model} textChars=${out.text.length}`)
    return out.text
  } catch (err) {
    console.error(`[study-ingest] ${programme.id}: extraction failed:`, err)
    return ''
  }
}
