// Sentry — Edge runtime init (middleware/proxy + edge routes; via instrumentation.ts).
import * as Sentry from '@sentry/nextjs'
import { SENTRY_DSN, scrubEvent } from '@/lib/sentry-scrub'

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
})
