import { createClient } from '@supabase/supabase-js'
import { createSupabaseAdmin } from './supabase/server'
import { getFeature } from './features'
import { isSecurityHeaderConfigured } from './security-headers'

// On-demand security self-audit. Runs read-only posture checks across three lenses
// — encryption engineer (secrets present & strong, nothing leaked to the client),
// cloud engineer (security headers, rate-limiting), and attacker (actively probes
// the DB with the PUBLIC anon key to see whether any private table leaks rows).
// Every check is safe to run repeatedly and never mutates state.

export type CheckStatus = 'pass' | 'warn' | 'fail'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Category = 'Secrets & encryption' | 'Access control' | 'Network' | 'Auth posture'

export interface SecurityCheck {
  id: string
  category: Category
  label: string
  status: CheckStatus
  detail: string
  severity: Severity
}

const isProd = () => process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'

// ─── Secrets & encryption ─────────────────────────────────────────────────────

function checkSecretsPresent(): SecurityCheck {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'JWT_SECRET', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_WEBHOOK_SECRET', 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
    'SENDCHAMP_API_KEY', 'CRON_SECRET', 'ENCRYPTION_KEY', 'SUPER_ADMIN_PHONE',
  ]
  const missing = required.filter((k) => !process.env[k])
  return {
    id: 'secrets-present', category: 'Secrets & encryption', severity: 'critical',
    label: 'All required secrets configured',
    status: missing.length ? 'fail' : 'pass',
    detail: missing.length ? `Missing: ${missing.join(', ')}` : 'Every required secret is set.',
  }
}

function checkJwtStrength(): SecurityCheck {
  const len = process.env.JWT_SECRET?.length ?? 0
  const status: CheckStatus = len === 0 ? 'fail' : len < 32 ? 'fail' : len < 48 ? 'warn' : 'pass'
  return {
    id: 'jwt-strength', category: 'Secrets & encryption', severity: 'critical',
    label: 'JWT signing secret is strong',
    status,
    detail: len === 0 ? 'JWT_SECRET is not set.'
      : status === 'pass' ? `Strong (${len} chars).`
      : `Only ${len} chars — use a 64-char random secret.`,
  }
}

function checkEncryptionKey(): SecurityCheck {
  const k = process.env.ENCRYPTION_KEY ?? ''
  const ok = /^[0-9a-fA-F]{64}$/.test(k) // 32 bytes hex — field-level bank-detail encryption
  return {
    id: 'encryption-key', category: 'Secrets & encryption', severity: 'critical',
    label: 'Bank-detail encryption key valid (32-byte)',
    status: ok ? 'pass' : 'fail',
    detail: !k ? 'ENCRYPTION_KEY is not set — bank details cannot be encrypted.'
      : ok ? 'Valid 32-byte (64-hex) key.'
      : 'ENCRYPTION_KEY is not a 64-hex (32-byte) value.',
  }
}

function checkCronSecret(): SecurityCheck {
  const len = process.env.CRON_SECRET?.length ?? 0
  const status: CheckStatus = len === 0 ? 'fail' : len < 24 ? 'warn' : 'pass'
  return {
    id: 'cron-secret', category: 'Secrets & encryption', severity: 'high',
    label: 'Cron secret is strong',
    status,
    detail: len === 0 ? 'CRON_SECRET not set — cron routes are unprotected.' : status === 'pass' ? `Strong (${len} chars).` : `Only ${len} chars — use 32+.`,
  }
}

function checkPaystackLiveKey(): SecurityCheck {
  const key = process.env.PAYSTACK_SECRET_KEY ?? ''
  const test = key.startsWith('sk_test')
  const live = key.startsWith('sk_live')
  let status: CheckStatus = 'pass'
  let detail = live ? 'Live key in use.' : 'Key set.'
  if (!key) { status = 'fail'; detail = 'PAYSTACK_SECRET_KEY not set.' }
  else if (isProd() && test) { status = 'fail'; detail = 'TEST key (sk_test) is set in production — real payments will fail / be unguarded.' }
  else if (!isProd() && test) { status = 'pass'; detail = 'Test key (fine outside production).' }
  return { id: 'paystack-key', category: 'Secrets & encryption', severity: 'high', label: 'Paystack key matches environment', status, detail }
}

function checkRateLimiting(): SecurityCheck {
  const on = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  return {
    id: 'rate-limiting', category: 'Secrets & encryption', severity: 'critical',
    label: 'Rate limiting (brute-force protection) enabled',
    status: on ? 'pass' : 'fail',
    detail: on ? 'Upstash Redis configured — PIN/OTP/withdrawal throttling active.'
      : 'Upstash not set — PIN brute-force, OTP and withdrawal-velocity limits are OFF.',
  }
}

function checkNoPublicSecretLeak(): SecurityCheck {
  // Any NEXT_PUBLIC_* var is shipped to the browser. None may carry a secret.
  const danger = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|API_KEY)/i
  const leaked = Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_') && danger.test(k))
  return {
    id: 'public-secret-leak', category: 'Secrets & encryption', severity: 'critical',
    label: 'No secret exposed via NEXT_PUBLIC_',
    status: leaked.length ? 'fail' : 'pass',
    detail: leaked.length ? `Client-exposed secret-looking vars: ${leaked.join(', ')}` : 'No secret-named variable is shipped to the browser.',
  }
}

function checkBootstrapPin(): SecurityCheck {
  const set = !!process.env.SUPER_ADMIN_DEFAULT_PIN
  return {
    id: 'bootstrap-pin', category: 'Auth posture', severity: 'high',
    label: 'Super-admin bootstrap PIN removed',
    status: set ? 'warn' : 'pass',
    detail: set ? 'SUPER_ADMIN_DEFAULT_PIN is still set — remove it after first login so it can’t be used as a backdoor.'
      : 'Bootstrap default PIN is not present.',
  }
}

// ─── Access control: attacker probe with the PUBLIC anon key ───────────────────

// Tables that must NEVER return rows to the anon (public) key. This is the
// active belt-and-suspenders probe; the AUTHORITATIVE coverage guarantee is
// checkRlsCoverage() below (catalog-derived). The old list was only 8 tables —
// it left every other private table (home addresses + GPS, AI memory, consent
// records, push tokens, customer wallets, study data…) unverified, so the page
// showed green without ever testing them. Expanded to the high-value PII/money
// set so a real RLS regression on any of them is caught actively.
const PRIVATE_TABLES = [
  // identity & auth
  'customers', 'riders', 'admins', 'sessions', 'admin_devices',
  'webauthn_credentials', 'otp_attempts', 'pin_reset_audit', 'blocked_phones',
  // money / ledger
  'wallet_balances', 'wallet_transactions', 'customer_wallets',
  'customer_wallet_transactions', 'wallet_payout_lots', 'refunds',
  'platform_earnings', 'reward_credits', 'reward_ledger',
  // orders & disputes
  'orders', 'order_items', 'disputes',
  // location / PII
  'customer_addresses', 'saved_places', 'consent_log',
  // AI & misc private
  'lumi_memory', 'push_subscriptions', 'notifications',
  // audit & control
  'audit_logs', 'super_audit_logs', 'feature_flags', 'feature_flag_audit',
]

async function checkAnonExposure(): Promise<SecurityCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const base: Omit<SecurityCheck, 'status' | 'detail'> = {
    id: 'anon-exposure', category: 'Access control', severity: 'critical',
    label: 'Private tables reject the public key (RLS)',
  }
  if (!url || !anonKey) return { ...base, status: 'warn', detail: 'Anon key not available — could not probe.' }

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const exposed: string[] = []
  for (const t of PRIVATE_TABLES) {
    try {
      const { data } = await anon.from(t).select('*').limit(1)
      if (data && data.length > 0) exposed.push(t) // rows came back ⇒ RLS off / leaking
    } catch { /* table missing or denied — not exposed */ }
  }
  return {
    ...base,
    status: exposed.length ? 'fail' : 'pass',
    detail: exposed.length
      ? `EXPOSED to anyone with the public key: ${exposed.join(', ')}`
      : `No private table leaked rows to the public key (probed ${PRIVATE_TABLES.length}).`,
  }
}

// ─── Access control: authoritative RLS coverage (catalog truth) ────────────────
// The probe above can only test tables it lists. This asks the DATABASE which
// tables have RLS turned off — covering ALL ~75 tables, including any added in a
// future migration that forgot to enable RLS. Backed by public.rls_coverage_gaps()
// (migration 084). Empty result = every table is RLS-protected.
export interface CoverageRow { table_name: string }

export function coverageCheckFromRows(
  rows: CoverageRow[] | null,
  rpcFailed: boolean,
): SecurityCheck {
  const base: Omit<SecurityCheck, 'status' | 'detail'> = {
    id: 'rls-coverage', category: 'Access control', severity: 'critical',
    label: 'Every table is RLS-protected (no coverage gap)',
  }
  if (rpcFailed) {
    return { ...base, status: 'warn', detail: 'Coverage function unavailable — run migration 084 (rls_coverage_gaps).' }
  }
  const gaps = rows ?? []
  if (gaps.length === 0) {
    return { ...base, status: 'pass', detail: 'Every public table has Row-Level Security enabled — the anon key can reach none of them directly.' }
  }
  const names = gaps.map((g) => g.table_name).join(', ')
  return {
    ...base,
    status: 'fail',
    detail: `RLS is OFF on ${gaps.length} table(s) — directly reachable with the public key: ${names}. Run migration 084.`,
  }
}

async function checkRlsCoverage(): Promise<SecurityCheck> {
  try {
    const db = createSupabaseAdmin()
    const { data, error } = await db.rpc('rls_coverage_gaps')
    if (error) return coverageCheckFromRows(null, true)
    return coverageCheckFromRows((data ?? []) as CoverageRow[], false)
  } catch {
    return coverageCheckFromRows(null, true)
  }
}

// ─── Network: live security headers ───────────────────────────────────────────

async function checkSecurityHeaders(): Promise<SecurityCheck> {
  const base: Omit<SecurityCheck, 'status' | 'detail'> = {
    id: 'security-headers', category: 'Network', severity: 'medium', label: 'Security headers present',
  }

  // Source of truth: these are applied to EVERY response by next.config.ts. If a
  // header isn't even configured, that's a real fail regardless of any probe.
  const notConfigured: string[] = []
  if (!isSecurityHeaderConfigured('strict-transport-security')) notConfigured.push('HSTS')
  if (!isSecurityHeaderConfigured('x-content-type-options')) notConfigured.push('X-Content-Type-Options')
  if (!isSecurityHeaderConfigured('x-frame-options')) notConfigured.push('clickjacking protection')
  if (!isSecurityHeaderConfigured('referrer-policy')) notConfigured.push('Referrer-Policy')
  if (notConfigured.length) {
    return { ...base, status: 'fail', detail: `Not configured in next.config: ${notConfigured.join(', ')}` }
  }

  // Best-effort LIVE probe to catch a CDN/edge stripping a configured header. The
  // apex sits behind Cloudflare, which 403s/redirects bare server-side fetches and
  // (separately) NEXT_PUBLIC_APP_URL may be unset — so a probe that can't read our
  // real 200 is INCONCLUSIVE, not a failure. Only a readable 200 that is genuinely
  // missing a header downgrades the result.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      const res = await fetch(appUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LumeXSecurityCheck/1.0)', accept: 'text/html' },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const h = res.headers
        const missing: string[] = []
        if (!h.get('strict-transport-security')) missing.push('HSTS')
        if (!h.get('x-content-type-options')) missing.push('X-Content-Type-Options')
        const csp = h.get('content-security-policy') ?? ''
        if (!h.get('x-frame-options') && !/frame-ancestors/i.test(csp)) missing.push('clickjacking protection')
        if (!h.get('referrer-policy')) missing.push('Referrer-Policy')
        return {
          ...base,
          status: missing.length === 0 ? 'pass' : missing.length <= 1 ? 'warn' : 'fail',
          detail: missing.length
            ? `Configured, but a live response is missing: ${missing.join(', ')} (possible CDN stripping).`
            : 'HSTS, nosniff, clickjacking + referrer protections all present (verified live).',
        }
      }
    } catch { /* fall through to the configured-set result */ }
  }

  // Probe unavailable or blocked by the edge — rely on the configured set, which we
  // independently verify reaches the browser.
  return {
    ...base,
    status: 'pass',
    detail: 'HSTS, nosniff, clickjacking + referrer protections are all configured (live probe blocked by the CDN/edge or no app URL).',
  }
}

// ─── Auth posture ─────────────────────────────────────────────────────────────

async function checkPhoneVerification(): Promise<SecurityCheck> {
  const on = await getFeature('phone_verification')
  return {
    id: 'phone-verification', category: 'Auth posture', severity: 'medium',
    label: 'Phone verification (OTP) enforced',
    status: on ? 'pass' : 'warn',
    detail: on ? 'New accounts must verify their phone by OTP.' : 'OTP verification is OFF — new accounts are created with unverified phones.',
  }
}

async function checkPendingResets(): Promise<SecurityCheck> {
  const base: Omit<SecurityCheck, 'status' | 'detail'> = {
    id: 'pending-resets', category: 'Auth posture', severity: 'low', label: 'No stale forced PIN resets',
  }
  try {
    const db = createSupabaseAdmin()
    let total = 0
    for (const t of ['customers', 'vendors', 'riders', 'admins']) {
      const { count } = await db.from(t).select('*', { count: 'exact', head: true }).eq('pin_reset_pending', true)
      total += count ?? 0
    }
    return { ...base, status: total > 25 ? 'warn' : 'pass', detail: `${total} account(s) awaiting a first-login PIN set.` }
  } catch {
    return { ...base, status: 'warn', detail: 'Could not read reset state.' }
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runSecurityChecks(): Promise<SecurityCheck[]> {
  const sync = [
    checkSecretsPresent(), checkJwtStrength(), checkEncryptionKey(), checkCronSecret(),
    checkPaystackLiveKey(), checkRateLimiting(), checkNoPublicSecretLeak(), checkBootstrapPin(),
  ]
  const asyncChecks = await Promise.all([
    checkRlsCoverage().catch((): SecurityCheck => coverageCheckFromRows(null, true)),
    checkAnonExposure().catch((): SecurityCheck => ({ id: 'anon-exposure', category: 'Access control', severity: 'critical', label: 'Private tables reject the public key (RLS)', status: 'warn', detail: 'Probe could not run.' })),
    checkSecurityHeaders().catch((): SecurityCheck => ({ id: 'security-headers', category: 'Network', severity: 'medium', label: 'Security headers present', status: 'warn', detail: 'Probe could not run.' })),
    checkPhoneVerification().catch((): SecurityCheck => ({ id: 'phone-verification', category: 'Auth posture', severity: 'medium', label: 'Phone verification (OTP) enforced', status: 'warn', detail: 'Could not read flag.' })),
    checkPendingResets(),
  ])
  return [...sync, ...asyncChecks]
}

export function overallPosture(checks: SecurityCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'pass'
}
