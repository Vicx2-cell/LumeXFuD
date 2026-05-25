import { createClient } from '@supabase/supabase-js'

// Server-side admin client using service role key — bypasses RLS for trusted server code.
// NEVER import this in client components or expose to the browser.
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
