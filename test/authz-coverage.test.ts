import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTE_POLICY, routeKey, unclassifiedRoutes } from '@/lib/authz-policy'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #5 — authz coverage backstop.
//
// THE GUARANTEE: every API route must declare an authorization class in
// ROUTE_POLICY. A new app/api/**/route.ts that forgets to → this test FAILS, so
// an un-gated privileged route can never ship unnoticed (the structural RED).
// ════════════════════════════════════════════════════════════════════════════

const API_DIR = join(process.cwd(), 'app', 'api')

// Recursively collect every route.ts under app/api and map to its policy key.
function allRouteKeys(dir = API_DIR): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...allRouteKeys(full))
    else if (entry.name === 'route.ts' || entry.name === 'route.tsx') out.push(routeKey(full))
  }
  return out
}

describe('authz coverage backstop', () => {
  const keys = allRouteKeys()

  it('found a realistic number of routes (sanity)', () => {
    expect(keys.length).toBeGreaterThan(120)
  })

  it('EVERY app/api route is classified in ROUTE_POLICY (no un-gated route can ship)', () => {
    const missing = unclassifiedRoutes(keys)
    expect(
      missing,
      `These routes are not declared in lib/authz-policy.ts ROUTE_POLICY — classify ` +
        `them (role/self/auth/public/cron/webhook): ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('PROVES the guard catches an unclassified route (a new ungated route fails CI)', () => {
    const withFake = [...keys, 'admin/secret-backdoor']
    expect(unclassifiedRoutes(withFake)).toEqual(['admin/secret-backdoor'])
  })

  it('every policy value is a valid, non-empty class', () => {
    for (const [k, p] of Object.entries(ROUTE_POLICY)) {
      expect(['role', 'self', 'auth', 'public', 'cron', 'webhook'], `${k}`).toContain(p.kind)
      if (p.kind === 'role') expect(p.roles.length, `${k} role list`).toBeGreaterThan(0)
    }
  })
})
