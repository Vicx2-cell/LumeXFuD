import { NextRequest, NextResponse } from 'next/server'
import { ZodError, type ZodTypeAny } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'

export async function requireFeedSession() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { session }
}

export async function parseJsonBody<T extends ZodTypeAny>(req: NextRequest, schema: T) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return { error: NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const err = parsed.error instanceof ZodError ? parsed.error : undefined
    return { error: NextResponse.json({ error: err?.issues[0]?.message ?? 'Invalid input' }, { status: 400 }) }
  }
  return { data: parsed.data }
}

export async function rateLimitFeed(key: string, requests: number, windowSeconds: number, failClosed = false) {
  const rl = await rateLimitGeneric(key, requests, windowSeconds, failClosed)
  if (!rl.success) return { error: NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 }) }
  return { ok: true }
}
