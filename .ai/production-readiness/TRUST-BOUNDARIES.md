# Trust boundaries

Initial boundaries: browser/PWA to Next.js proxy/pages/APIs; browser anon Supabase/realtime to RLS; trusted Next server to Supabase service role; Next to Upstash, Paystack, Sendchamp, Resend, Sentry, AI providers and maps; Paystack/WhatsApp to webhook handlers; Vercel scheduler to cron handlers; admin browsers to privileged APIs; uploads to Supabase Storage; future native wrapper to web/auth/deep links. Detailed attack paths are pending Phase 4.
