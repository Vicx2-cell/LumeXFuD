// Read-only: dump ingested catalog rows for a programme. No AI, no writes.
// Usage: node --env-file=.env.local scripts/study-catalog-dump.mjs biochemistry
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })
const prog = process.argv[2] || 'biochemistry'

const { data, error } = await db
  .from('study_catalog_courses')
  .select('level,semester,code,title,credit_units,kind,status,confidence,source_url,verified')
  .eq('programme_id', prog)
  .order('level', { ascending: true })
  .order('semester', { ascending: true })
  .order('code', { ascending: true })

if (error) {
  console.error('query error:', error.message)
  process.exit(1)
}

console.log(`programme=${prog}  rows=${data.length}`)
const byStatus = {}
for (const r of data) byStatus[r.status] = (byStatus[r.status] || 0) + 1
console.log('status counts:', JSON.stringify(byStatus))
console.log('—'.repeat(40))
for (const r of data) {
  console.log(
    `${r.level}/${r.semester}  ${r.code.padEnd(10)} ${String(r.title).slice(0, 42).padEnd(42)} ${r.credit_units}u ${r.kind.padEnd(8)} ${r.status.padEnd(17)} conf=${r.confidence} verified=${r.verified}`,
  )
}
