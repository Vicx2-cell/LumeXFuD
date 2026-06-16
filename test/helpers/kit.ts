/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import type { SessionPayload, SessionRole } from '@/lib/session'

// ─── Request builder ──────────────────────────────────────────────────────────
// A real NextRequest so route handlers' req.json()/headers/nextUrl/cookies all work.
export function makeReq(opts: {
  method?: string
  url?: string
  body?: unknown
  headers?: Record<string, string>
} = {}): NextRequest {
  const { method = 'POST', url = 'http://localhost/api/test', body, headers = {} } = opts
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  }
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body)
  return new NextRequest(url, init)
}

// Next.js route context: params is a Promise in the app router.
export function ctxWithId(id = 'test-id') {
  return { params: Promise.resolve({ id }) }
}

// ─── Session fixtures ─────────────────────────────────────────────────────────
export const ALL_ROLES: SessionRole[] = ['customer', 'vendor', 'rider', 'admin', 'super_admin']

export function session(role: SessionRole, userId = `user-${role}`): SessionPayload {
  return { sessionId: `sess-${role}`, userId, phone: `+234800000${role.length}00`, role }
}

// First role NOT in the allowed set — guaranteed to be rejected with 403.
export function pickWrongRole(allow: SessionRole[]): SessionRole {
  const wrong = ALL_ROLES.find((r) => !allow.includes(r))
  if (!wrong) throw new Error('every role is allowed — no wrong-role case')
  return wrong
}

// ─── Chainable Supabase mock ──────────────────────────────────────────────────
// Returns a fake `createSupabaseAdmin()` whose query builder resolves per-table
// canned responses. Terminal `.single()/.maybeSingle()` and awaiting the builder
// (insert/update/delete/select-list) all resolve to the configured row.
// `rows` is read live on every `.from()` so tests can mutate it between calls.
export type DbRows = Record<string, { data: unknown; error: unknown }>

export function makeDb(rowsRef: { rows: DbRows }) {
  function builder(table: string): any {
    const res = rowsRef.rows[table] ?? { data: null, error: null }
    const p = Promise.resolve(res)
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return p.then.bind(p)
          if (prop === 'catch') return p.catch.bind(p)
          if (prop === 'finally') return p.finally.bind(p)
          if (prop === 'single' || prop === 'maybeSingle') return () => p
          return () => proxy
        },
      },
    )
    return proxy
  }
  return {
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: null }),
  }
}

// All rate-limit exports stubbed to "allowed", so access-control assertions are
// never masked by a fail-closed 429 (which happens with no Upstash env).
export const PASS_RL = async () => ({ success: true, remaining: 99, reset: 0 })
