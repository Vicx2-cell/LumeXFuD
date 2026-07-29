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
    db.from('contact_cases').select('reference_number, requester_name, requester_email, intent, subject, message, status, owner_queue, acknowledgement_status, escalation_due_at, created_at').order('created_at', { ascending: false }).limit(100),
  ])
  return <main className="min-h-dvh bg-[#0A0A0B] p-5 text-white"><div className="mx-auto max-w-6xl space-y-8"><div><h1 className="text-2xl font-bold">Email operations and support inbox</h1><p className="mt-1 text-sm text-white/50">Provider delivery, failures, and routed contact cases. Support complaints entered in-app are visible here.</p></div>
    <section><h2 className="mb-3 font-semibold">Delivery events</h2><div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-left text-xs"><thead className="bg-white/5"><tr><th className="p-3">Workflow</th><th className="p-3">Recipient</th><th className="p-3">Status</th><th className="p-3">Attempts</th><th className="p-3">Provider ID / error</th><th className="p-3">Action</th></tr></thead><tbody>{(deliveries ?? []).map((row) => <tr key={row.id} className="border-t border-white/10"><td className="p-3">{row.kind}</td><td className="p-3">{row.recipient}</td><td className="p-3">{row.status}</td><td className="p-3">{row.attempt_count}</td><td className="p-3">{row.resend_id ?? row.error_code ?? '—'}</td><td className="p-3">{row.status === 'FAILED' ? <RetryButton eventId={row.id} /> : '—'}</td></tr>)}</tbody></table></div></section>
    <section><h2 className="mb-3 font-semibold">Contact cases</h2><div className="overflow-hidden rounded-2xl border border-white/10"><div className="grid gap-px bg-white/10 md:grid-cols-2 xl:grid-cols-3">{(cases ?? []).map((row) => <article key={row.reference_number} className="bg-[#111113] p-4 text-xs"><div className="flex items-start justify-between gap-3"><div><p className="text-white/55">{row.reference_number}</p><h3 className="mt-1 text-sm font-semibold text-white">{row.subject}</h3></div><span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60">{row.status}</span></div><div className="mt-3 space-y-1 text-white/55"><p>{row.requester_name} · {row.requester_email}</p><p>Intent: {row.intent}</p><p>Queue: {row.owner_queue}</p><p>Acknowledgement: {row.acknowledgement_status}</p></div><details className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3"><summary className="cursor-pointer text-[11px] font-semibold text-[#F5A623]">View message</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/75">{row.message}</p></details><p className="mt-3 text-[11px] text-white/35">Escalate by {new Date(row.escalation_due_at).toLocaleString('en-NG')}</p></article>)}</div></div></section>
  </div></main>
}
