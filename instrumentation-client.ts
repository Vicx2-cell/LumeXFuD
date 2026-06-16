// Sentry — browser/client init. Next.js loads this automatically on the client.
// The browser bundle can only read NEXT_PUBLIC_* env vars, so the client DSN
// comes from NEXT_PUBLIC_SENTRY_DSN (a DSN is a write-only ingestion key — safe
// to expose). Never hardcoded.
import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  // Session Replay is OFF — it would record the DOM (phone numbers, PINs,
  // payment fields). Do not enable without masking review.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
})

// Instruments client-side navigations so route changes get error context.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
