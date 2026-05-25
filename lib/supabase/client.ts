'use client'

import { createClient } from '@supabase/supabase-js'

// Browser client using anon key — subject to RLS policies.
// Use for realtime subscriptions and public data reads only.
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}
