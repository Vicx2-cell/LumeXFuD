import { Redis } from '@upstash/redis'
import {
  LUMI_STATE_TTL_SECONDS,
  type LumiConversationState,
  type LumiConversationStateInput,
  lumiConversationStateSchema,
} from './types'

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

const redis = getRedis()

function conversationKey(userId: string): string {
  return `lumi:conversation:${userId}`
}

export function createIdleState(): LumiConversationState {
  return {
    version: 1,
    step: 'idle',
    updatedAt: new Date().toISOString(),
  }
}

export function validateConversationState(
  value: unknown,
): LumiConversationState | null {
  if (!value || typeof value !== 'object') return null
  const parsed = lumiConversationStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export async function getState(userId: string): Promise<LumiConversationState | null> {
  if (!redis) return null
  try {
    const raw = await redis.get(conversationKey(userId))
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return validateConversationState(parsed)
  } catch (error) {
    console.error('[lumi/state] failed to load conversation state:', error)
    return null
  }
}

export async function setState(userId: string, input: LumiConversationStateInput): Promise<void> {
  if (!redis) return
  const state = lumiConversationStateSchema.parse({
    ...input,
    updatedAt: new Date().toISOString(),
  })
  await redis.set(conversationKey(userId), state, { ex: LUMI_STATE_TTL_SECONDS })
}

export async function clearState(userId: string): Promise<void> {
  if (!redis) return
  await redis.del(conversationKey(userId))
}
