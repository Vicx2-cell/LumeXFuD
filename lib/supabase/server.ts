import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createPlaywrightCommerceSupabase } from './playwright-commerce-fixture'

// Server-side admin client using service role key — bypasses RLS for trusted server code.
// The `server-only` import above makes an accidental client import a BUILD error
// (the service-role key must never reach the browser) — enforced, not just by convention.
type AdminClient = SupabaseClient

export function createSupabaseAdmin(): AdminClient {
  if (
    process.env.PLAYWRIGHT_COMMERCE_FIXTURE === '1' &&
    process.env.SUPABASE_SERVICE_ROLE_KEY === 'playwright-service-role-key'
  ) {
    // Test-only deterministic data for local Playwright commerce verification.
    // Production still requires real Supabase credentials and never enters here.
    return createPlaywrightCommerceSupabase() as unknown as AdminClient
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
