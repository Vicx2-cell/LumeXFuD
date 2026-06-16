// Sentry — Node.js server runtime init (loaded via instrumentation.ts).
import * as Sentry from '@sentry/nextjs'
import { SENTRY_DSN, scrubEvent } from '@/lib/sentry-scrub'

Sentry.init({
  dsn: SENTRY_DSN,
  // No DSN configured → SDK is inert (safe for local dev / tests).
  enabled: Boolean(SENTRY_DSN),
  // Never let Sentry auto-attach IPs, cookies, headers or user data.
  sendDefaultPii: false,
  // Light tracing for request context; transactions are scrubbed too.
  tracesSampleRate: 0.1,
  // Final PII/secret guard before anything leaves the process.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
})
