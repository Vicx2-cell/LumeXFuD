import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerInput } from '@/lib/validators'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('required account email', () => {
  const validRegistration = {
    name: 'Ada Nwosu', email: 'ada@example.com', phone: '+2348012345678',
    default_delivery_address: 'ABSU Campus', pin: '739152', confirm_pin: '739152',
    question_1: 'First school?', answer_1: 'Model', question_2: 'Birth town?', answer_2: 'Uturu',
  }

  it('requires and normalizes customer registration email', () => {
    expect(registerInput.safeParse({ ...validRegistration, email: '' }).success).toBe(false)
    expect(registerInput.safeParse({ ...validRegistration, email: 'not-an-email' }).success).toBe(false)
    const parsed = registerInput.parse({ ...validRegistration, email: ' ADA@EXAMPLE.COM ' })
    expect(parsed.email).toBe('ada@example.com')
  })

  it.each([
    'app/api/admin/vendors/create/route.ts',
    'app/api/admin/riders/create/route.ts',
    'app/api/super-admin/team/create/route.ts',
  ])('%s validates and persists email', (path) => {
    const source = read(path)
    expect(source).toContain("z.string().trim().email().max(254)")
    expect(source).toMatch(/\bemail,/)
  })

  it('requires verified email for social accounts and email capture for WhatsApp accounts', () => {
    expect(read('app/api/auth/social/complete/route.ts')).toContain('A verified email address is required')
    expect(read('lib/whatsapp-handler.ts')).toContain("case 'ONBOARD_EMAIL'")
  })

  it('enforces email on every new account table at the database boundary', () => {
    const migration = read('supabase/migrations/131_account_email_required.sql')
    for (const table of ['customers', 'vendors', 'riders', 'admins']) {
      expect(migration).toContain(`${table}_require_email_on_insert`)
    }
    expect(migration).toContain('accounts_missing_email_admin')
  })
})
