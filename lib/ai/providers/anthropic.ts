import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, MODELS } from '../client'
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChatRequest,
  LLMChatResponse,
  LLMMessage,
  LLMToolCall,
} from './types'

// Anthropic-backed LLMProvider. It REUSES the single gated client from
// lib/ai/client.ts (getAnthropic) — same master `ai` kill switch, same
// ANTHROPIC_API_KEY, same memoised instance. This adapter maps the neutral
// LLMRequest/LLMChatRequest onto the exact messages.create calls the routes
// already made, so the Anthropic path's behaviour is unchanged.

// Anthropic's accepted inline image media types.
type AnthropicImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function imageBlock(base64: string, mimeType: string): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: mimeType as AnthropicImageMime, data: base64 } }
}

function joinText(content: Anthropic.ContentBlock[]): string {
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

// Map a neutral LLMMessage onto an Anthropic MessageParam.
function toAnthropicMessage(m: LLMMessage): Anthropic.MessageParam {
  if (m.toolResults?.length) {
    return {
      role: 'user',
      content: m.toolResults.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content })),
    }
  }
  if (m.toolCalls?.length) {
    const blocks: Anthropic.ContentBlockParam[] = []
    if (m.text) blocks.push({ type: 'text', text: m.text })
    for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
    return { role: 'assistant', content: blocks }
  }
  if (m.images?.length) {
    const blocks: Anthropic.ContentBlockParam[] = m.images.map((i) => imageBlock(i.base64, i.mimeType))
    blocks.push({ type: 'text', text: m.text ?? '' })
    return { role: 'user', content: blocks }
  }
  return { role: m.role, content: m.text ?? '' }
}

class AnthropicProvider implements LLMProvider {
  async generate(req: LLMRequest): Promise<LLMResponse> {
    // Capability guard: Anthropic models do not accept raw audio. Voice input
    // must be routed to Gemini (the router does this); failing loud here protects
    // against a mis-wired call ever silently dropping the audio.
    if (req.audio?.length) {
      throw new Error('AUDIO_UNSUPPORTED_ANTHROPIC: voice input requires the Gemini provider')
    }

    const client = await getAnthropic()
    if (!client) {
      throw new Error('Anthropic is not available (missing ANTHROPIC_API_KEY or the AI master switch is off).')
    }

    // Web-grounded requests use the stronger vision/Sonnet model; a photo present
    // → vision model; otherwise the fast text model (Haiku).
    const model = req.webSearch || req.images?.length ? MODELS.vision : MODELS.fast

    const content: Anthropic.ContentBlockParam[] = []
    for (const img of req.images ?? []) content.push(imageBlock(img.base64, img.mimeType))
    content.push({ type: 'text', text: req.userText })

    // jsonMode is a no-op for Anthropic (no responseMimeType); our JSON prompts
    // already instruct "JSON only", so output is identical to the prior calls.
    const tools = req.webSearch
      ? ([{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }] as unknown as Anthropic.Messages.ToolUnion[])
      : undefined

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content }]
    let res = await client.messages.create({ model, max_tokens: req.maxTokens ?? 1024, system: req.system, messages, tools })

    // Server-side web-search can pause_turn; re-send to resume (bounded).
    let guard = 0
    while (req.webSearch && res.stop_reason === 'pause_turn' && guard++ < 10) {
      messages.push({ role: 'assistant', content: res.content })
      res = await client.messages.create({ model, max_tokens: req.maxTokens ?? 1024, system: req.system, messages, tools })
    }

    return { text: joinText(res.content), provider: 'anthropic', model }
  }

  async chat(req: LLMChatRequest): Promise<LLMChatResponse> {
    const client = await getAnthropic()
    if (!client) {
      throw new Error('Anthropic is not available (missing ANTHROPIC_API_KEY or the AI master switch is off).')
    }

    const hasImages = req.messages.some((m) => m.images?.length)
    const model = hasImages ? MODELS.vision : MODELS.fast
    const messages = req.messages.map(toAnthropicMessage)
    const tools: Anthropic.Tool[] | undefined = req.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }))

    const res = await client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      tools,
      messages,
    })

    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    const toolCalls: LLMToolCall[] = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }))

    return { text, toolCalls, provider: 'anthropic', model }
  }
}

export const anthropicProvider: LLMProvider = new AnthropicProvider()
