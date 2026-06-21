// Client-safe constant. Lives in its own module (no server imports) so client
// components — the PIN setup + register pages — can use it WITHOUT pulling in
// lib/pin-auth.ts, which imports the service-role Supabase admin client
// (lib/supabase/server.ts is `server-only`). pin-auth re-exports this for server
// callers, so existing `@/lib/pin-auth` imports keep working.
export const SECURITY_QUESTIONS = [
  'What was the name of your first pet?',
  "What is your mother's maiden name?",
  'What was the name of your primary school?',
  'What is your favorite food?',
  'What city were you born in?',
] as const
