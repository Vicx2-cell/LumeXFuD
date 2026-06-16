// One-off: clear ALL Upstash rate-limit buckets for the super-admin phone and
// reset any DB-level PIN lock, so a locked-out super admin can log in again.
// Usage: node scripts/clear-rate-limit.mjs
import { readFileSync } from 'node:fs'
import { Redis } from '@upstash/redis'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '')
}

const rawPhone = process.env.SUPER_ADMIN_PHONE
if (!rawPhone) { console.error('SUPER_ADMIN_PHONE not set'); process.exit(1) }

// Match on the last 10 digits (national subscriber number) so we catch the key
// regardless of how the phone was formatted (+234.., 234.., 0..).
const digits = rawPhone.replace(/\D/g, '')
const last10 = digits.slice(-10)
const e164 = '+234' + last10
console.log(`Super admin: ${rawPhone}  (E.164 ${e164}, matching *${last10}*)`)

// ── 1. Upstash: scan + delete every rate-limit bucket for this phone ──────────
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

let cursor = '0'
const keys = new Set()
do {
  const [next, batch] = await redis.scan(cursor, { match: `*${last10}*`, count: 1000 })
  cursor = String(next)
  for (const k of batch) keys.add(k)
} while (cursor !== '0')

console.log(`\nUpstash keys matching the phone: ${keys.size}`)
for (const k of keys) console.log(`  - ${k}`)
if (keys.size) {
  await redis.del(...keys)
  console.log(`Deleted ${keys.size} key(s).`)
} else {
  console.log('No rate-limit keys to clear (already expired or never set).')
}

// ── 2. DB: clear PIN attempt lock on the super-admin customers row ────────────
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: before } = await db.from('customers').select('id, pin_attempts, pin_locked_until').eq('phone', e164).maybeSingle()
if (!before) {
  console.log(`\nNo customers row for ${e164} (nothing to reset).`)
} else {
  console.log(`\nDB before: pin_attempts=${before.pin_attempts} pin_locked_until=${before.pin_locked_until}`)
  await db.from('customers').update({ pin_attempts: 0, pin_locked_until: null }).eq('id', before.id)
  console.log('DB reset: pin_attempts=0, pin_locked_until=null')
}

console.log('\n✅ Super-admin rate limit cleared. Try logging in now.')
