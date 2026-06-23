const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'PAYSTACK_SECRET_KEY',
  'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
  'PAYSTACK_WEBHOOK_SECRET',
  'SENDCHAMP_API_KEY',
  'SENDCHAMP_SENDER',
  'NEXT_PUBLIC_APP_URL',
  'CRON_SECRET',
  'ENCRYPTION_KEY', // 32 bytes (64 hex) — field-level encryption for bank details
  // ADMIN_PHONE is optional — operational admins are provisioned via the
  // super-admin panel (admins table), not designated by env.
  'SUPER_ADMIN_PHONE',
  // SUPER_ADMIN_DEFAULT_PIN is intentionally NOT required: it is a one-time
  // bootstrap secret used only to CREATE the super-admin row on first login.
  // Once that account exists it should be DELETED from the environment so it can
  // never be used to re-create a super-admin (a standing backdoor). The login
  // route treats it as optional and simply skips bootstrap when it is absent.
] as const

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nCopy .env.example to .env.local and fill in the values.`
    )
  }
  if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters')
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    // Rate limiting fails OPEN without Upstash (lib/rate-limit.ts), which turns
    // off PIN brute-force / OTP / withdrawal-velocity protection — a stated
    // non-negotiable (rule #10). Tolerable in local dev, but a prod deploy must
    // never ship with this off: fail fast instead of silently being insecure.
    const message =
      '[env] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — rate limiting is DISABLED. PIN brute-force protection is off.'
    // Fail fast on a real hosted deploy (Vercel sets VERCEL=1 in build+runtime)
    // so we can never ship to production with brute-force protection off. Local
    // dev / local prod builds (VERCEL unset) keep the soft warning.
    if (process.env.VERCEL) {
      throw new Error(message + ' Set Upstash Redis credentials in the Vercel project before deploying.')
    }
    console.warn(message)
  }
}
