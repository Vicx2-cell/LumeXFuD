import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { redactDetail } from '@/lib/security-events'
import { signSessionToken } from '@/lib/session'

// ════════════════════════════════════════════════════════════════════════════
// FORTRESS surface #2 — JWT auth: spine + secret-strength VERIFY.
// ════════════════════════════════════════════════════════════════════════════

describe('redactDetail — secrets never reach the log', () => {
  it('strips secret-looking keys at any depth, keeps benign fields', () => {
    const out = redactDetail({
      reason: 'revoked', attempts: 3,
      pin: '123456', token: 'abc', phone: '+2348012345678',
      nested: { otp: '0000', ok: true, bankAccountNumber: '1234567890' },
      list: [{ secret: 's' }, { fine: 1 }],
    }) as Record<string, unknown>
    expect(out.reason).toBe('revoked')
    expect(out.attempts).toBe(3)
    expect(out.pin).toBe('[redacted]')
    expect(out.token).toBe('[redacted]')
    expect(out.phone).toBe('[redacted]')
    expect((out.nested as Record<string, unknown>).otp).toBe('[redacted]')
    expect((out.nested as Record<string, unknown>).ok).toBe(true)
    expect((out.nested as Record<string, unknown>).bankAccountNumber).toBe('[redacted]')
    expect(((out.list as unknown[])[0] as Record<string, unknown>).secret).toBe('[redacted]')
    expect(((out.list as unknown[])[1] as Record<string, unknown>).fine).toBe(1)
  })
})

describe('getSecret — weak JWT_SECRET is rejected at runtime', () => {
  it('refuses to sign with a too-short secret (RED #3)', async () => {
    const old = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'short-secret'
    try {
      await expect(
        signSessionToken({ sessionId: 's', phone: '+2348000000000', role: 'customer' }),
      ).rejects.toThrow(/too short/i)
    } finally {
      process.env.JWT_SECRET = old
    }
  })

  it('signs with a strong (>=32 char) secret', async () => {
    const old = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'x'.repeat(64)
    try {
      const t = await signSessionToken({ sessionId: 's', phone: '+2348000000000', role: 'customer' })
      expect(typeof t).toBe('string')
      expect(t.split('.').length).toBe(3)
    } finally {
      process.env.JWT_SECRET = old
    }
  })
})

// ─── Migration 085 audit: spine is hash-chained AND append-only for everyone ──
describe('migration 085 — security_events is an immutable, hash-chained spine', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations')
  const file = readdirSync(dir).find((f) => f.startsWith('085_'))
  const sql = file ? readFileSync(join(dir, file), 'utf8') : ''

  it('exists', () => { expect(file, 'migration 085 must exist').toBeTruthy() })

  it('creates the table and a tamper-evident hash chain', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS security_events/i)
    expect(sql).toMatch(/prev_hash/i)
    expect(sql).toMatch(/row_hash/i)
    expect(sql).toMatch(/sha256/i)
    // Appends serialized so concurrent inserts can't fork the chain.
    expect(sql).toMatch(/pg_advisory_xact_lock/i)
  })

  it('blocks UPDATE, DELETE and TRUNCATE', () => {
    expect(sql).toMatch(/security_events is append-only/i)
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON security_events/i)
    expect(sql).toMatch(/BEFORE TRUNCATE ON security_events/i)
  })

  it('does NOT exempt service_role from the mutation guard (fires for everyone)', () => {
    // Slice the block-mutation function body and assert it contains no role check.
    const start = sql.indexOf('FUNCTION security_events_block_mutation')
    const after = sql.indexOf('DROP TRIGGER', start)
    const body = sql.slice(start, after === -1 ? undefined : after)
    expect(start, 'block_mutation function present').toBeGreaterThan(-1)
    expect(body).not.toMatch(/auth\.role/i) // no service_role exemption
    expect(body).toMatch(/RAISE EXCEPTION/i)
  })

  it('ships a chain verifier locked to the service role', () => {
    expect(sql).toMatch(/FUNCTION security_events_verify_chain/i)
    expect(sql).toMatch(/REVOKE[\s\S]*security_events_verify_chain[\s\S]*anon/i)
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]*security_events_verify_chain[\s\S]*service_role/i)
    // Anon/authenticated cannot read the spine.
    expect(sql).toMatch(/REVOKE ALL ON TABLE security_events FROM anon, authenticated/i)
  })
})
