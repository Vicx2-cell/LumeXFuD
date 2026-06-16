// One-off: ensure the public 'menu-images' storage bucket exists.
// Run: node scripts/create-menu-bucket.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Minimal .env.local loader (no dotenv dependency assumed).
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '')
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing SUPABASE env vars'); process.exit(1) }

const db = createClient(url, key, { auth: { persistSession: false } })

const opts = { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'] }

const { error } = await db.storage.createBucket('menu-images', opts)
if (error && !/already exists/i.test(error.message)) {
  console.error('createBucket failed:', error.message); process.exit(1)
}
// If it already existed, make sure it's public with the right limits.
const { error: upErr } = await db.storage.updateBucket('menu-images', opts)
if (upErr) { console.error('updateBucket failed:', upErr.message); process.exit(1) }

const { data: buckets } = await db.storage.listBuckets()
const b = buckets?.find((x) => x.id === 'menu-images')
console.log('OK — menu-images bucket ready:', b ? `public=${b.public}` : '(not found?)')
