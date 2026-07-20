// Read-only wallet diagnostic. Why are holds not releasing / withdrawals failing?
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const naira = (k) => '₦' + (Number(k) / 100).toLocaleString()
const now = Date.now()

// 1. Relevant settings (payouts gate, platform freeze, hold policy)
const { data: settings } = await db.from('settings').select('id, value')
  .in('id', ['payouts_mode', 'withdrawals_frozen', 'maintenance', 'hold_rider_base_minutes', 'hold_rider_new_minutes', 'hold_vendor_base_minutes', 'hold_vendor_new_minutes', 'hold_new_account_threshold'])
console.log('=== SETTINGS ===')
for (const s of settings ?? []) console.log(`  ${s.id} = ${JSON.stringify(s.value)}`)
if (!(settings ?? []).some((s) => s.id === 'payouts_mode')) console.log('  payouts_mode = (unset → defaults to auto)')
if (!(settings ?? []).some((s) => s.id === 'withdrawals_frozen')) console.log('  withdrawals_frozen = (unset → false)')

// 2. Wallet balances
const { data: bals } = await db.from('wallet_balances').select('user_id,user_type,total_balance,available_balance,held_balance,is_frozen')
let held = 0, avail = 0, frozen = 0
for (const b of bals ?? []) { held += Number(b.held_balance); avail += Number(b.available_balance); if (b.is_frozen) frozen++ }
console.log(`\n=== WALLET BALANCES (${(bals ?? []).length} wallets) ===`)
console.log(`  total held = ${naira(held)}   total available = ${naira(avail)}   frozen wallets = ${frozen}`)
for (const b of (bals ?? []).filter((b) => Number(b.held_balance) > 0).slice(0, 15)) {
  console.log(`  ${b.user_type.padEnd(6)} ${b.user_id.slice(0,8)} held=${naira(b.held_balance)} avail=${naira(b.available_balance)} frozen=${b.is_frozen}`)
}

// 3. Pending HOLD transactions — due vs future
const { data: holds } = await db.from('wallet_transactions').select('id,user_type,amount,release_at,status').eq('type', 'HOLD').eq('status', 'PENDING').limit(1000)
let due = 0, future = 0, noRelease = 0
for (const h of holds ?? []) {
  if (!h.release_at) noRelease++
  else if (new Date(h.release_at).getTime() <= now) due++
  else future++
}
console.log(`\n=== PENDING HOLD TXNS (${(holds ?? []).length}) ===`)
console.log(`  due now (should have released) = ${due}   still in hold (future) = ${future}   null release_at = ${noRelease}`)

// 4. Orders stuck mid-payout
// counts come back on the response; re-query with count
const delivCount = (await db.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'DELIVERED').eq('wallet_released', false)).count
const compCount = (await db.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED').eq('wallet_released', false)).count
console.log(`\n=== ORDERS ===`)
console.log(`  DELIVERED & wallet_released=false (awaiting credit) = ${delivCount}`)
console.log(`  COMPLETED & wallet_released=false (stranded) = ${compCount}`)

// 5. Recent withdrawals — WHY do they fail?
const { data: wd } = await db.from('wallet_transactions').select('user_type,amount,status,failure_reason,created_at').eq('type', 'WITHDRAWAL').order('created_at', { ascending: false }).limit(15)
console.log(`\n=== RECENT WITHDRAWALS (${(wd ?? []).length}) ===`)
for (const w of wd ?? []) console.log(`  ${new Date(w.created_at).toISOString().slice(0,16)} ${w.user_type} ${naira(w.amount)} ${w.status} ${w.failure_reason ? '— ' + w.failure_reason : ''}`)

console.log('\nDone.')
