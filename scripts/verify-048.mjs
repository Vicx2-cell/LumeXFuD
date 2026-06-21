// Step-0 audit check: is migration 048 (vendors/ratings column-grant lockdown)
// applied in the live DB? Runs the actual exploit with the PUBLIC anon key:
// attempts to read bank columns from vendors and customer_id from ratings.
//   node scripts/verify-048.mjs
// PASS = anon is denied the sensitive columns (048 applied).
// FAIL = anon can read them (048 NOT applied — bank details world-readable).

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
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(2)
}

const anonDb = createClient(url, anon, { auth: { persistSession: false } })
let failed = false

// 1) vendors bank columns
{
  const { data, error } = await anonDb
    .from('vendors')
    .select('id, bank_account_number, bank_account_name, bank_code, paystack_subaccount_code')
    .limit(1)
  if (error) {
    console.log(`vendors bank columns: DENIED ✅  (${error.message})`)
  } else {
    failed = true
    console.log(`vendors bank columns: READABLE ❌  rows=${data?.length ?? 0}`, data?.[0] ?? '(no active rows, but SELECT was permitted)')
  }
}

// 2) vendors safe columns should still work (sanity)
{
  const { error } = await anonDb.from('vendors').select('id, shop_name').limit(1)
  console.log(`vendors safe columns: ${error ? `ERROR ⚠️ (${error.message})` : 'readable ✅ (expected)'}`)
}

// 3) ratings.customer_id (reviewer de-anonymization)
{
  const { data, error } = await anonDb.from('ratings').select('id, customer_id, order_id').limit(1)
  if (error) {
    console.log(`ratings identity columns: DENIED ✅  (${error.message})`)
  } else {
    failed = true
    console.log(`ratings identity columns: READABLE ❌  rows=${data?.length ?? 0}`)
  }
}

console.log(failed ? '\nRESULT: 048 NOT fully applied — STOP and apply it in prod.' : '\nRESULT: 048 appears applied (anon denied sensitive columns).')
process.exit(failed ? 1 : 0)
