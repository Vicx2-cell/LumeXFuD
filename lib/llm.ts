import 'server-only'
import OpenAI from 'openai'

// ─── Swappable LLM provider (Meta Llama API, OpenAI-compatible) ──────────────
// The WhatsApp bot's free-text answers (vendor/rider FAQ) go through THIS single
// function. It talks to Meta's Llama API via its OpenAI-compatible endpoint, so
// repointing to ANY other OpenAI-compatible Llama host is a pure config change:
// set LLAMA_BASE_URL / LLAMA_MODEL — no logic changes here or at call sites.
//
// Defaults follow Meta's Llama API docs (llama.developer.meta.com):
//   base URL : https://api.llama.com/compat/v1/   (OpenAI-compatible surface)
//   model    : Llama-3.3-70B-Instruct
export const LLAMA_BASE_URL = process.env.LLAMA_BASE_URL || 'https://api.llama.com/compat/v1/'
export const LLAMA_MODEL = process.env.LLAMA_MODEL || 'Llama-3.3-70B-Instruct'

export type LlamaMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Lazily constructed so importing this module never throws when LLAMA_API_KEY is
// absent (the bot must degrade gracefully — a missing key only fails an actual
// call, which callers catch and answer with a graceful fallback).
let _client: OpenAI | null = null
function getClient(): OpenAI {
  // trim() also strips a stray leading BOM that some shells/CI prepend, which
  // would otherwise crash the SDK when the key goes into an Authorization header.
  const apiKey = process.env.LLAMA_API_KEY?.trim()
  if (!apiKey) throw new Error('LLAMA_API_KEY is not set — cannot use the Llama provider.')
  if (!_client) _client = new OpenAI({ apiKey, baseURL: LLAMA_BASE_URL })
  return _client
}

/** True when the Llama provider is usable (key present). */
export function isLlamaConfigured(): boolean {
  return !!process.env.LLAMA_API_KEY?.trim()
}

/**
 * One non-streaming chat completion. `messages` is a standard OpenAI-style array
 * (include a leading {role:'system'} for instructions). Returns the assistant's
 * text, or throws on transport/auth errors — callers MUST catch and fall back.
 */
export async function askLlama(messages: LlamaMessage[]): Promise<string> {
  const client = getClient()
  const res = await client.chat.completions.create({
    model: LLAMA_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 600,
  })
  return res.choices[0]?.message?.content?.trim() ?? ''
}
