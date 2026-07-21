import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('security incident evidence model', () => {
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/135_security_incidents.sql'), 'utf8')
  const lifecycle = readFileSync(join(process.cwd(), 'supabase/migrations/139_security_incident_case_lifecycle.sql'), 'utf8')
  const exportRoute = readFileSync(join(process.cwd(), 'app/api/super-admin/security-incidents/[id]/export/route.ts'), 'utf8')
  const caseRoute = readFileSync(join(process.cwd(), 'app/api/super-admin/security-incidents/[id]/route.ts'), 'utf8')
  const createRoute = readFileSync(join(process.cwd(), 'app/api/super-admin/security-incidents/route.ts'), 'utf8')
  const refundRoute = readFileSync(join(process.cwd(), 'app/api/paystack/refund/route.ts'), 'utf8')
  const consolePage = readFileSync(join(process.cwd(), 'app/super-admin/incidents/page.tsx'), 'utf8')

  it('creates incidents, event timelines, evidence holds, and append-only custody', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS security_incidents/i)
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS security_incident_events/i)
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS security_evidence_custody/i)
    expect(migration).toMatch(/evidence_hold BOOLEAN NOT NULL/i)
    expect(migration).toMatch(/security evidence custody is append-only/i)
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON security_evidence_custody/i)
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON security_incident_events/i)
    expect(migration).toMatch(/create_security_incident/i)
  })

  it('labels approximate location as an indicator, not identity proof', () => {
    expect(migration).toMatch(/not proof of identity or presence/i)
  })

  it('prepares a hashed human-review export and never submits externally', () => {
    expect(exportRoute).toMatch(/Prepared for authorized human review/i)
    expect(exportRoute).toMatch(/automatic_submission: false/i)
    expect(exportRoute).toMatch(/human_authorization_required: true/i)
    expect(exportRoute).toMatch(/createHash\('sha256'\)/i)
    expect(exportRoute).toMatch(/action: 'EXPORTED'/i)
    expect(exportRoute).not.toMatch(/fetch\(|EFCC|sendEmail|sendSms|sendWhatsApp/i)
  })

  it('persists affected order, payment, and lawful approximate-location facts', () => {
    expect(lifecycle).toMatch(/create_security_incident_v2/i)
    expect(lifecycle).toMatch(/affected_orders, affected_payments/i)
    expect(lifecycle).toMatch(/approximate_location/i)
    expect(createRoute).toMatch(/affected_orders:[\s\S]*affected_payments:[\s\S]*approximate_location:/i)
    expect(createRoute).toMatch(/create_security_incident_v2/i)
    expect(refundRoute).toMatch(/p_orders: \[order\.id\]/i)
    expect(refundRoute).toMatch(/p_payments: \[order\.paystack_reference\]/i)
  })

  it('requires super-admin human review and fails closed if the evidence event is unavailable', () => {
    expect(caseRoute).toMatch(/session\.role !== 'super_admin'/i)
    expect(caseRoute).toMatch(/factual_note:[\s\S]*min\(3\)[\s\S]*max\(500\)/i)
    expect(caseRoute).toMatch(/if \(!eventId\)[\s\S]*503/i)
    expect(caseRoute).toMatch(/update_security_incident_case/i)
  })

  it('keeps false-positive and resolution transitions append-only and reversible', () => {
    expect(lifecycle).toMatch(/FALSE_POSITIVE/i)
    expect(lifecycle).toMatch(/INSERT INTO security_incident_events/i)
    expect(lifecycle).toMatch(/STATUS_CHANGED/i)
    expect(lifecycle).not.toMatch(/DELETE FROM security_incidents|DELETE FROM security_incident_events/i)
    expect(lifecycle).not.toMatch(/account_restrictions|session_revoked|unfreeze|wallet/i)
    expect(consolePage).toMatch(/Marking false-positive does not delete evidence or automatically change account restrictions/i)
  })
})
