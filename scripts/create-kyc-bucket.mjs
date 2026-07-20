import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
// PRIVATE bucket — KYC selfies are sensitive (NDPR). No public read; admins view via signed URLs.
const { error } = await db.storage.createBucket('kyc-faces', {
  public: false,
  fileSizeLimit: 5242880,
  allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
})
if (error && !/already exists/i.test(error.message)) { console.error('ERROR:', error.message); process.exit(1) }
console.log(error ? 'Bucket already exists (ok).' : 'Created private bucket kyc-faces.')
