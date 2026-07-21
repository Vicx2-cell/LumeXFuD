import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('security incident evidence model', () => {
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/135_security_incidents.sql'), 'utf8')
  const exportRoute = readFileSync(join(process.cwd(), 'app/api/super-admin/security-incidents/[id]/export/route.ts'), 'utf8')

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
})
