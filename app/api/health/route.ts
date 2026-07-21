import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { verifyCronSecret } from '@/lib/cron-health'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Check = { ok: boolean; ms?: number; detail?: string }

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function timed(fn: () => Promise<void>): Promise<Check> {
  const start = Date.now()
  try {
    await fn()
    return { ok: true, ms: Date.now() - start }
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function GET(req: NextRequest) {
  const start = Date.now()
  const context = createRequestContext(req.headers)
  const deep = req.nextUrl.searchParams.get('deep') === '1'

  const checks: Record<string, Check> = {
    app: { ok: true },
  }

  if (deep) {
    if (!verifyCronSecret(req.headers.get('authorization'))) {
      return applyRequestContext(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), context)
    }

    checks.supabase = await timed(async () => {
      const { error } = await createSupabaseAdmin().from('settings').select('id').limit(1)
      if (error) throw new Error(error.message)
    })

    const r = redis()
    checks.redis = r
      ? await timed(async () => { await r.ping() })
      : { ok: false, detail: 'not_configured' }
  }

  const ok = Object.values(checks).every((check) => check.ok)
  const status = ok ? 'ok' : 'degraded'
  const durationMs = Date.now() - start

  const payload = {
    status,
    generated_at: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? null,
    request_id: context.requestId,
    correlation_id: context.correlationId,
    checks,
  }

  if (!ok || durationMs > 1000) {
    console.warn('[health]', {
      status,
      duration_ms: durationMs,
      request_id: context.requestId,
      correlation_id: context.correlationId,
      checks,
    })
  }

  return applyRequestContext(NextResponse.json(payload, { status: ok ? 200 : 503 }), context)
}
