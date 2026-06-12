// Precondition check for migration 028's non-negative CHECK constraints.
//   node scripts/check-wallet-negatives.mjs
// Reads .env.local for SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL.
// Exits non-zero (and lists offenders) if any wallet holds a negative balance —
// those rows must be corrected before 028 can apply its CHECK constraints.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv(path = '.env.local') {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const { data: wallets, error: wErr } = await db
  .from('wallet_balances')
  .select('user_id, user_type, total_balance, available_balance, held_balance')
  .or('total_balance.lt.0,available_balance.lt.0,held_balance.lt.0')

const { data: cwallets, error: cErr } = await db
  .from('customer_wallets')
  .select('customer_id, balance_kobo')
  .lt('balance_kobo', 0)

if (wErr || cErr) {
  console.error('Query failed:', wErr?.message ?? cErr?.message)
  process.exit(2)
}

const bad = (wallets ?? []).length + (cwallets ?? []).length
if (bad === 0) {
  console.log('✓ No negative balances. Migration 028 CHECK constraints will apply cleanly.')
  process.exit(0)
}

console.error(`✗ Found ${bad} wallet row(s) with a negative balance — fix before applying 028:`)
for (const w of wallets ?? []) console.error('  vendor/rider', w)
for (const w of cwallets ?? []) console.error('  customer', w)
process.exit(1)
