import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { coverageCheckFromRows } from '@/lib/security-health'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #1 — RLS coverage backstop.
//
// The public anon key ships in the browser bundle, so Row-Level Security is the
// ONLY wall between that key and the database on the direct-to-PostgREST path.
// Coverage is maintained by hand across 30+ migrations: one forgotten
// `ENABLE ROW LEVEL SECURITY` = a silently world-readable table.
//
// RED EXPLOIT this suite makes impossible: "ship a new table in a migration with
// no RLS, and nothing notices." This test reads every migration and FAILS if any
// created table lacks an ENABLE ROW LEVEL SECURITY line — so the regression is
// caught in CI, not in production.
// ════════════════════════════════════════════════════════════════════════════

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
}

// Strip a leading schema qualifier and any quotes so `public."Foo"` → `Foo`.
function cleanTable(raw: string): string {
  return raw.replace(/^public\./i, '').replace(/["`]/g, '').toLowerCase()
}

// Parse all migrations into the set of tables created and the set RLS-enabled.
// Lines that are SQL comments (start with `--`) are ignored so prose like
// "002's CREATE TABLE IF NOT EXISTS was a no-op" is not mistaken for a table.
function parseCoverage() {
  const created = new Set<string>()
  const rlsEnabled = new Set<string>()
  const dropped = new Set<string>()

  const createRe = /\bCREATE TABLE\s+(?:IF NOT EXISTS\s+)?([A-Za-z0-9_."`]+)/i
  const enableRe = /\bALTER TABLE\s+(?:IF EXISTS\s+)?([A-Za-z0-9_."`]+)\s+ENABLE ROW LEVEL SECURITY/i
  const dropRe = /\bDROP TABLE\s+(?:IF EXISTS\s+)?([A-Za-z0-9_."`]+)/i

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const line of sql.split('\n')) {
      if (line.trim().startsWith('--')) continue // skip comment lines
      const c = createRe.exec(line)
      if (c) created.add(cleanTable(c[1]))
      const e = enableRe.exec(line)
      if (e) rlsEnabled.add(cleanTable(e[1]))
      const d = dropRe.exec(line)
      if (d) dropped.add(cleanTable(d[1]))
    }
  }
  return { created, rlsEnabled, dropped }
}

describe('RLS coverage backstop (FORTRESS surface #1)', () => {
  it('every table created by a migration also enables Row-Level Security', () => {
    const { created, rlsEnabled, dropped } = parseCoverage()

    // Tables intentionally exempt from this static check, with a documented
    // reason. Empty by design — the goal is that NOTHING is exempt.
    const EXEMPT = new Set<string>([])

    const missing = [...created].filter(
      (t) => !rlsEnabled.has(t) && !dropped.has(t) && !EXEMPT.has(t),
    )

    expect(
      missing,
      `Tables created without "ENABLE ROW LEVEL SECURITY" — exposed to the public ` +
        `anon key. Add RLS in the migration that creates them: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('migration 084 ships the self-healing RLS backstop + coverage function', () => {
    const file = migrationFiles().find((f) => f.startsWith('084_'))
    expect(file, 'migration 084 (RLS coverage backstop) must exist').toBeTruthy()
    const sql = readFileSync(join(MIGRATIONS_DIR, file!), 'utf8')

    // Self-healing loop that enables RLS on any unprotected public table.
    expect(sql).toMatch(/relrowsecurity\s*=\s*false/i)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i)
    // Authoritative coverage function…
    expect(sql).toMatch(/FUNCTION\s+public\.rls_coverage_gaps/i)
    // …that the anon key cannot call to enumerate the schema.
    expect(sql).toMatch(/REVOKE[\s\S]*rls_coverage_gaps[\s\S]*anon/i)
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]*rls_coverage_gaps[\s\S]*service_role/i)
  })
})

describe('coverageCheckFromRows — security-health verdict logic', () => {
  it('passes when the DB reports zero coverage gaps', () => {
    const c = coverageCheckFromRows([], false)
    expect(c.status).toBe('pass')
    expect(c.severity).toBe('critical')
  })

  it('fails and names the exposed tables when gaps exist', () => {
    const c = coverageCheckFromRows([{ table_name: 'saved_places' }, { table_name: 'lumi_memory' }], false)
    expect(c.status).toBe('fail')
    expect(c.detail).toContain('saved_places')
    expect(c.detail).toContain('lumi_memory')
  })

  it('warns (not fails) when the coverage function is unavailable', () => {
    const c = coverageCheckFromRows(null, true)
    expect(c.status).toBe('warn')
    expect(c.detail).toMatch(/migration 084/i)
  })
})
