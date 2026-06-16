// Reconcile every wallet: stored balance vs its own transaction ledger. Read-only.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const naira = (k) => '₦' + (Number(k) / 100).toLocaleString()

const { data: bals } = await db.from('wallet_balances').select('user_id,user_type,total_balance,available_balance,held_balance')
const { data: txs } = await db.from('wallet_transactions').select('user_id,user_type,type,amount,status')

// Ledger-derived total per wallet: credits in, withdrawals out.
const ledger = new Map()
for (const t of txs ?? []) {
  const k = t.user_id + '|' + t.user_type
  const cur = ledger.get(k) ?? 0
  const a = Number(t.amount)
  if (t.type === 'HOLD' || t.type === 'CREDIT') ledger.set(k, cur + a)            // money in (held or available)
  else if (t.type === 'WITHDRAWAL' && t.status !== 'FAILED') ledger.set(k, cur - a) // money out
  else if (t.type === 'WITHDRAWAL_REVERSAL') ledger.set(k, cur + a)
  // RELEASE just moves held->available, doesn't change total — skip
}

console.log('Wallet reconciliation (stored total vs ledger total):\n')
let bad = 0
for (const b of bals ?? []) {
  const k = b.user_id + '|' + b.user_type
  const ledgerTotal = ledger.get(k) ?? 0
  const stored = Number(b.total_balance)
  const diff = stored - ledgerTotal
  const flag = diff === 0 ? 'OK ' : '❌ '
  if (diff !== 0) bad++
  console.log(`${flag}${b.user_type.padEnd(6)} ${b.user_id.slice(0,8)}  stored=${naira(stored).padStart(9)}  ledger=${naira(ledgerTotal).padStart(9)}  diff=${naira(diff)}`)
}
console.log(`\n${bad === 0 ? '✅ All wallets reconcile.' : `⚠️ ${bad} wallet(s) have a stored-vs-ledger mismatch (pre-ledger test residue).`}`)
