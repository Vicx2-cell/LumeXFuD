import 'server-only'

// Provider-neutral LLM contract. Each AI module talks to THIS interface, never to
// a vendor SDK directly, so a module can run on Anthropic or Gemini with no code
// change — only an env var (see ./index.ts). Server-only: keys and model calls
// must never reach the client bundle.

export interface LLMImage {
  base64: string
  mimeType: string
}

export interface LLMAudio {
  base64: string
  mimeType: string
}

// ─── Single-shot generation ───────────────────────────────────────────────────
export interface LLMRequest {
  /** System prompt — kept SEPARATE from untrusted userText on every provider. */
  system: string
  /** The user-turn text (already wrapUntrusted()-fenced by the caller if needed). */
  userText: string
  /** Optional inline images (base64). Present → a vision-capable model is chosen. */
  images?: LLMImage[]
  /**
   * Optional inline audio (base64) — e.g. a vendor's spoken menu. Only Gemini
   * accepts raw audio; Anthropic rejects it (see ./anthropic.ts), so the router
   * force-routes any request carrying audio to Gemini (see getProviderForRequest).
   */
  audio?: LLMAudio[]
  /** Ask the provider for strict JSON output where it supports a native mode. */
  jsonMode?: boolean
  /** Cap on output tokens. */
  maxTokens?: number
  /**
   * Ground the answer in live web search (Anthropic web_search / Gemini Google
   * Search grounding). Used by the study-curriculum ingestion.
   */
  webSearch?: boolean
}

export interface LLMResponse {
  text: string
  provider: 'anthropic' | 'gemini'
  model: string
}

// ─── Multi-turn tool-calling (agents: Lumi, rider assistant) ───────────────────
export interface LLMTool {
  name: string
  description: string
  /** JSON Schema object describing the tool's input. */
  parameters: Record<string, unknown>
}

export interface LLMToolCall {
  /** Stable id used to match a result back to this call. */
  id: string
  name: string
  args: Record<string, unknown>
}

export interface LLMToolResult {
  /** The id of the LLMToolCall this answers. */
  id: string
  name: string
  /** JSON-serialisable result, as a string. */
  content: string
}

export interface LLMMessage {
  role: 'user' | 'assistant'
  /** Plain text for the turn (optional when the turn is purely tool calls/results). */
  text?: string
  /** Inline images on a user turn. */
  images?: LLMImage[]
  /** Tool calls the assistant made on its turn. */
  toolCalls?: LLMToolCall[]
  /** Results returned (on a user turn) for the assistant's prior tool calls. */
  toolResults?: LLMToolResult[]
}

export interface LLMChatRequest {
  system: string
  messages: LLMMessage[]
  tools?: LLMTool[]
  maxTokens?: number
}

export interface LLMChatResponse {
  text: string
  toolCalls: LLMToolCall[]
  provider: 'anthropic' | 'gemini'
  model: string
}

export interface LLMProvider {
  /** Single-shot generation (optionally multimodal / JSON / web-grounded). */
  generate(req: LLMRequest): Promise<LLMResponse>
  /** One agent turn: returns the assistant's text and any tool calls it made. */
  chat(req: LLMChatRequest): Promise<LLMChatResponse>
}
