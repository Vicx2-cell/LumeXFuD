import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('multi-account referral evidence integration', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/auth/register/route.ts'), 'utf8')
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/138_referral_multi_account_review.sql'), 'utf8')

  it('passes a keyed correlation token instead of raw user-agent', () => {
    expect(route).toMatch(/referralCorrelationToken/i)
    expect(route).toMatch(/p_correlation_token: correlationToken/i)
    expect(route).not.toMatch(/p_device: userAgent/i)
    expect(route).toMatch(/REFERRAL_SIGNAL_SECRET \?\? process\.env\.JWT_SECRET/i)
  })

  it('requires same referrer, valid token, and three claims within 24 hours', () => {
    expect(migration).toMatch(/referrer_id = v_referrer AND device_hash = p_correlation_token/i)
    expect(migration).toMatch(/created_at >= now\(\) - interval '24 hours'/i)
    expect(migration).toMatch(/v_review := v_recent >= 2/i)
    expect(migration).not.toMatch(/signup_ip = p_ip/i)
  })

  it('holds only referral rewards and requires human review', () => {
    expect(migration).toMatch(/reward_state[\s\S]*'manual_review'/i)
    expect(migration).toMatch(/v_ref\.reward_state = 'manual_review' THEN RETURN/i)
    expect(migration).toMatch(/Request indicators do not prove identity/i)
    expect(migration).not.toMatch(/UPDATE customers[\s\S]*(suspend|ban|block)/i)
  })

  it('records only correlation facts, never the token', () => {
    expect(route).toMatch(/eventType: 'multi_account_indicator'/i)
    const detail = route.slice(route.indexOf('matched_recent_claims'), route.indexOf("warning: 'Request indicators"))
    expect(detail).not.toMatch(/correlationToken|userAgent|ipAddress/i)
  })
})
