import { z } from 'zod'

// Zod schemas for every LLM output (AI_SPEC §0.6). Nothing the model returns is
// ever JSON.parse'd straight into business logic — it goes through parseModelJson
// here, with one retry then a deterministic fallback at the call site.

// ─── Module A — Menu Digitizer output ───────────────────────────────────────
export const MenuDigest = z.object({
  items: z.array(
    z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(200).nullable(),
      // null = unreadable, NEVER guessed (AI_SPEC §2 acceptance criteria)
      price_ngn: z.number().int().positive().nullable(),
      confidence: z.enum(['high', 'medium', 'low']),
      option_groups: z.array(
        z.object({
          name: z.string().max(60), // e.g. "Protein", "Extras"
          min_select: z.number().int().min(0),
          max_select: z.number().int().min(1),
          options: z.array(
            z.object({
              name: z.string().max(60),
              price_ngn: z.number().int().min(0).nullable(),
            })
          ),
        })
      ),
    })
  ),
  // descriptions of parts the model couldn't read
  unreadable_sections: z.array(z.string()),
})
export type MenuDigest = z.infer<typeof MenuDigest>

// ─── Module B3 — Sentinel triage brief ──────────────────────────────────────
export const TriageBrief = z.object({
  severity: z.enum(['SEV1', 'SEV2', 'SEV3']),
  headline: z.string().min(1).max(120),
  what_broke: z.string().min(1),
  likely_cause: z.string().min(1),
  blast_radius: z.string().min(1),
  first_action: z.string().min(1),
  correlated_with_deploy: z.boolean(),
})
export type TriageBrief = z.infer<typeof TriageBrief>

// ─── Admin dispute analyst (advisory only — a human resolves) ────────────────
export const DisputeBrief = z.object({
  summary: z.string().min(1).max(400),
  customer_claim: z.string().min(1).max(300),
  key_facts: z.array(z.string().max(200)),
  risk_flags: z.array(z.string().max(200)), // e.g. "Repeat disputer (5 prior)"
  suggested_resolution: z.enum(['REFUND', 'NO_ACTION', 'PARTIAL', 'NEEDS_MORE_INFO']),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().min(1).max(600),
})
export type DisputeBrief = z.infer<typeof DisputeBrief>

// Concierge = the admin brief PLUS the empathetic line shown to the customer.
// One model call produces both (see DISPUTE_CONCIERGE_PROMPT).
export const DisputeConcierge = DisputeBrief.extend({
  customer_reply: z.string().min(1).max(500),
})
export type DisputeConcierge = z.infer<typeof DisputeConcierge>

// ─── Module D1 — Belle intent ───────────────────────────────────────────────
export const BelleIntent = z.object({
  budget_ngn: z.number().int().positive().nullable(),
  craving_terms: z.array(z.string()),
  category_hints: z.array(
    z.enum([
      'rice',
      'swallow',
      'snacks',
      'drinks',
      'protein',
      'breakfast',
      'dessert',
      'any',
    ])
  ),
  constraints: z.array(z.string()),
  meal_context: z.enum(['breakfast', 'lunch', 'dinner', 'late_night', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type BelleIntent = z.infer<typeof BelleIntent>

// ─── Parsing helper ──────────────────────────────────────────────────────────
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Strip ```json fences a model sometimes adds despite "no markdown" instructions. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

/**
 * Parse + Zod-validate a raw model string. On failure returns a human-readable
 * `error` (suitable to append to a retry prompt). NEVER throws — a bad model
 * response must not crash a user flow.
 */
export function parseModelJson<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown
  try {
    json = JSON.parse(stripFences(raw))
  } catch {
    return { ok: false, error: 'Model did not return valid JSON.' }
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `JSON did not match schema: ${detail}` }
  }
  return { ok: true, data: result.data }
}
