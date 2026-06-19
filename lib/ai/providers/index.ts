import 'server-only'
import { getFeature } from '../../features'
import { getControls, type AIProvider } from '../../controls'
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import type { LLMProvider, LLMRequest } from './types'

// Router: which provider runs the app's AI features.
//
// There is ONE active provider for the whole app, resolved live from the
// super-admin Controls toggle (settings row `ai_provider`), which is itself
// seeded from the AI_PROVIDER_DEFAULT env var. Flip Gemini ↔ Anthropic from the
// Controls page with no redeploy; the change propagates within ~15s (controls
// cache). The master `ai` feature flag still gates ALL of it (cost kill switch).
//
// `moduleKey` is accepted for readability/telemetry at call sites (e.g. 'lumi',
// 'sentinel') but does not change the choice — the toggle is global, by design,
// to keep the control unambiguous.
export type AIModuleKey = string

function instance(name: AIProvider): LLMProvider {
  return name === 'gemini' ? geminiProvider : anthropicProvider
}

/** The active provider name, from the live super-admin toggle. */
export async function getActiveProviderName(_moduleKey?: AIModuleKey): Promise<AIProvider> {
  return (await getControls()).ai_provider
}

/** The active provider instance. */
export async function resolveProvider(moduleKey?: AIModuleKey): Promise<LLMProvider> {
  return instance(await getActiveProviderName(moduleKey))
}

/**
 * Capability-aware resolve: a request carrying AUDIO must run on Gemini
 * regardless of the toggle, because Anthropic models cannot accept raw audio.
 * This is the ONLY case where provider choice is overridden by capability.
 */
export async function resolveProviderForRequest(req: LLMRequest, moduleKey?: AIModuleKey): Promise<LLMProvider> {
  if (req.audio?.length) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('VOICE_NEEDS_GEMINI: set GEMINI_API_KEY to use voice menus')
    }
    return geminiProvider // force Gemini, ignore the toggle
  }
  return resolveProvider(moduleKey)
}

/**
 * Is AI usable right now? Gates on the master `ai` feature flag (the cost kill
 * switch — applies to BOTH providers) AND the active provider's API key. For the
 * Anthropic path this is exactly the old `getAnthropic() !== null` gate, so its
 * 503/skip behaviour is unchanged.
 */
export async function isAIAvailable(moduleKey?: AIModuleKey): Promise<boolean> {
  if (!(await getFeature('ai').catch(() => false))) return false // master kill switch
  const name = await getActiveProviderName(moduleKey)
  if (name === 'gemini') return !!process.env.GEMINI_API_KEY
  return !!process.env.ANTHROPIC_API_KEY
}

export type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMImage,
  LLMAudio,
  LLMTool,
  LLMToolCall,
  LLMToolResult,
  LLMMessage,
  LLMChatRequest,
  LLMChatResponse,
} from './types'
