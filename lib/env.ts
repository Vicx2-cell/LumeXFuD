const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'PAYSTACK_SECRET_KEY',
  'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
  'PAYSTACK_WEBHOOK_SECRET',
  'TERMII_API_KEY',
  'TERMII_SENDER_ID',
  'NEXT_PUBLIC_APP_URL',
  'CRON_SECRET',
  'ADMIN_PHONE',
  'SUPER_ADMIN_PHONE',
  'SUPER_ADMIN_DEFAULT_PIN',
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
    console.warn('[env] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — rate limiting is DISABLED. PIN brute-force protection is off.')
  }
}
