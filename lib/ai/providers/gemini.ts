import 'server-only'
import { GoogleGenAI } from '@google/genai'
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChatRequest,
  LLMChatResponse,
  LLMMessage,
  LLMToolCall,
} from './types'

// Gemini-backed LLMProvider, using the current official @google/genai SDK (NOT
// the deprecated @google/generative-ai). All calls are server-side; the key only
// ever lives in process.env.
//
// The client is created LAZILY (not at module load) so that importing this file —
// which the router always does — never throws when GEMINI_API_KEY is absent. A
// missing key only fails an actual Gemini call, leaving the Anthropic-default
// paths fully functional with no Gemini key configured.
let _ai: GoogleGenAI | null = null
function getClient(): GoogleGenAI {
  // trim() strips stray whitespace AND a leading BOM (U+FEFF) — some shells/CI
  // prepend one when setting the env var, which otherwise crashes the SDK with
  // "Cannot convert argument to a ByteString" when the key goes into a header.
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set — cannot use the Gemini provider.')
  }
  if (!_ai) _ai = new GoogleGenAI({ apiKey })
  return _ai
}

type Part = { text: string } | { inlineData: { data: string; mimeType: string } }
type FnPart = { functionCall: { name: string; args: Record<string, unknown> } }
type FnResponsePart = { functionResponse: { name: string; response: Record<string, unknown> } }
type GeminiContent = { role: 'user' | 'model'; parts: Array<Part | FnPart | FnResponsePart> }

function visionModel(): string {
  return process.env.GEMINI_MODEL_VISION?.trim() || 'gemini-2.5-flash'
}
function textModel(): string {
  return process.env.GEMINI_MODEL_TEXT?.trim() || 'gemini-2.5-flash-lite'
}

// Gemini functionResponse.response must be an OBJECT. Tool results travel as
// strings through the neutral interface; wrap non-object JSON so Gemini accepts it.
function asResponseObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return { result: parsed }
  } catch {
    return { result: content }
  }
}

function toGeminiContent(m: LLMMessage): GeminiContent {
  if (m.toolResults?.length) {
    return {
      role: 'user',
      parts: m.toolResults.map((r) => ({ functionResponse: { name: r.name, response: asResponseObject(r.content) } })),
    }
  }
  if (m.toolCalls?.length) {
    const parts: Array<Part | FnPart> = []
    if (m.text) parts.push({ text: m.text })
    for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.args } })
    return { role: 'model', parts }
  }
  if (m.images?.length) {
    const parts: Part[] = [{ text: m.text ?? '' }]
    for (const img of m.images) parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } })
    return { role: 'user', parts }
  }
  return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text ?? '' }] }
}

class GeminiProvider implements LLMProvider {
  async generate(req: LLMRequest): Promise<LLMResponse> {
    const ai = getClient()

    // A single user turn = a parts array: text first, then any inline media.
    // Audio rides inline exactly like images (Gemini multimodal).
    const contents: Part[] = [{ text: req.userText }]
    for (const img of req.images ?? []) contents.push({ inlineData: { data: img.base64, mimeType: img.mimeType } })
    for (const a of req.audio ?? []) contents.push({ inlineData: { data: a.base64, mimeType: a.mimeType } })

    // Keep the system prompt SEPARATE from the untrusted user content.
    const config: Record<string, unknown> = { systemInstruction: req.system }
    // responseMimeType and Google Search grounding cannot be combined; grounding
    // wins (the study extractor instructs JSON in its prompt instead).
    if (req.webSearch) config.tools = [{ googleSearch: {} }]
    else if (req.jsonMode) config.responseMimeType = 'application/json'
    if (req.maxTokens) config.maxOutputTokens = req.maxTokens

    // Any media (image/audio) or grounded search → the vision-capable model
    // (also handles audio); pure text → the cheaper text-lite model.
    const hasMedia = !!(req.images?.length || req.audio?.length || req.webSearch)
    const model = hasMedia ? visionModel() : textModel()

    const res = await ai.models.generateContent({ model, contents, config })
    return { text: res.text ?? '', provider: 'gemini', model }
  }

  async chat(req: LLMChatRequest): Promise<LLMChatResponse> {
    const ai = getClient()
    const hasImages = req.messages.some((m) => m.images?.length)
    const model = hasImages ? visionModel() : textModel()
    const contents = req.messages.map(toGeminiContent)

    const config: Record<string, unknown> = { systemInstruction: req.system }
    if (req.tools?.length) {
      config.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ]
    }
    if (req.maxTokens) config.maxOutputTokens = req.maxTokens

    const res = await ai.models.generateContent({ model, contents, config })
    const calls = res.functionCalls ?? []
    const toolCalls: LLMToolCall[] = calls.map((c, i) => ({
      // Gemini function calls may omit ids; synthesise a stable one per turn.
      id: c.id ?? `${c.name ?? 'tool'}-${i}`,
      name: c.name ?? '',
      args: (c.args ?? {}) as Record<string, unknown>,
    }))
    return { text: res.text ?? '', toolCalls, provider: 'gemini', model }
  }
}

export const geminiProvider: LLMProvider = new GeminiProvider()
