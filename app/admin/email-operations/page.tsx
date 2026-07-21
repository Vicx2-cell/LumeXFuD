import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { RetryButton } from './retry-button'

export const dynamic = 'force-dynamic'

export default async function EmailOperationsPage() {
  const session = await getCurrentUser()
  if (!session || !['admin', 'super_admin'].includes(session.role)) redirect('/auth')
  const db = createSupabaseAdmin()
  const [{ data: deliveries }, { data: cases }] = await Promise.all([
    db.from('email_operations_admin').select('*').order('created_at', { ascending: false }).limit(100),
    db.from('contact_cases').select('reference_number, intent, status, owner_queue, acknowledgement_status, escalation_due_at, created_at').order('created_at', { ascending: false }).limit(100),
  ])
  return <main className="min-h-dvh bg-[#0A0A0B] p-5 text-white"><div className="mx-auto max-w-6xl space-y-8"><div><h1 className="text-2xl font-bold">Email operations</h1><p className="mt-1 text-sm text-white/50">Provider delivery, failures and routed cases. Message bodies are not shown or logged.</p></div>
    <section><h2 className="mb-3 font-semibold">Delivery events</h2><div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-left text-xs"><thead className="bg-white/5"><tr><th className="p-3">Workflow</th><th className="p-3">Recipient</th><th className="p-3">Status</th><th className="p-3">Attempts</th><th className="p-3">Provider ID / error</th><th className="p-3">Action</th></tr></thead><tbody>{(deliveries ?? []).map((row) => <tr key={row.id} className="border-t border-white/10"><td className="p-3">{row.kind}</td><td className="p-3">{row.recipient}</td><td className="p-3">{row.status}</td><td className="p-3">{row.attempt_count}</td><td className="p-3">{row.resend_id ?? row.error_code ?? '—'}</td><td className="p-3">{row.status === 'FAILED' ? <RetryButton eventId={row.id} /> : '—'}</td></tr>)}</tbody></table></div></section>
    <section><h2 className="mb-3 font-semibold">Contact cases</h2><div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-left text-xs"><thead className="bg-white/5"><tr><th className="p-3">Reference</th><th className="p-3">Intent</th><th className="p-3">Queue</th><th className="p-3">Status</th><th className="p-3">Acknowledgement</th><th className="p-3">Escalate by</th></tr></thead><tbody>{(cases ?? []).map((row) => <tr key={row.reference_number} className="border-t border-white/10"><td className="p-3">{row.reference_number}</td><td className="p-3">{row.intent}</td><td className="p-3">{row.owner_queue}</td><td className="p-3">{row.status}</td><td className="p-3">{row.acknowledgement_status}</td><td className="p-3">{new Date(row.escalation_due_at).toLocaleString('en-NG')}</td></tr>)}</tbody></table></div></section>
  </div></main>
}
