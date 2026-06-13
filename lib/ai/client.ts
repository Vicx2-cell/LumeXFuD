import Anthropic from '@anthropic-ai/sdk'
import { getFeature } from '../features'

// ─── Model constants ────────────────────────────────────────────────────────
// Overridable via env (AI_SPEC §8) but always with a safe default so a missing
// env var degrades to a sensible model rather than crashing. `fast` is Haiku for
// everything high-frequency (Belle, triage, digest); `vision` is Sonnet for the
// rare menu-photo onboarding pass.
export const MODELS = {
  fast: process.env.AI_MODEL_FAST || 'claude-haiku-4-5',
  vision: process.env.AI_MODEL_VISION || 'claude-sonnet-4-6',
} as const

export type AIModel = (typeof MODELS)[keyof typeof MODELS]

// ─── Client factory ─────────────────────────────────────────────────────────
// ANTHROPIC_API_KEY is intentionally NOT a required env var (lib/env.ts): every
// AI path must degrade gracefully when the key is absent (AI_SPEC principle: "AI
// is garnish, not load-bearing"). Callers MUST handle a null return and fall
// back to the non-AI path — never crash a user flow because AI is unconfigured.
let _client: Anthropic | null = null

// Master AI kill switch: the super-admin `ai` feature flag (default OFF) gates
// EVERY Anthropic call in the app from this single choke point. Off (or no key)
// → null, and every caller already falls back to its non-AI path, so no credit
// is ever spent. Async because the flag lives in the settings table (toggleable
// from the super-admin UI with no redeploy). Fails safe to OFF if the flag can't
// be read.
export async function getAnthropic(): Promise<Anthropic | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  if (!(await getFeature('ai'))) return null
  if (!_client) _client = new Anthropic({ apiKey })
  return _client
}

/** True when AI is usable: key present AND the master switch is on. */
export async function isAIConfigured(): Promise<boolean> {
  return !!process.env.ANTHROPIC_API_KEY && (await getFeature('ai'))
}
