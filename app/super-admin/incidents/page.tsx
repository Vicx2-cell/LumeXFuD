'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

interface Incident {
  id: string
  incident_id: string
  severity: string
  confidence: number
  classification: string
  status: string
  account_id: string | null
  account_role: string | null
  triggered_rules: string[]
  containment_actions: string[]
  affected_orders: string[]
  affected_payments: string[]
  approximate_location: { label?: string; accuracy_m?: number } | null
  location_accuracy_warning: string
  evidence_hold: boolean
  recommended_action: string | null
  created_at: string
}

interface TimelineRow {
  incident_id: string
  factual_note: string | null
  security_events: {
    id: number; created_at: string; event_type: string; severity: string
    actor_role: string | null; session_id: string | null; ip: string | null
    user_agent: string | null; request_id: string | null; route: string | null
    outcome: string | null; row_hash: string
  } | null
}

export default function SecurityIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [timeline, setTimeline] = useState<TimelineRow[]>([])
  const [integrity, setIntegrity] = useState('UNKNOWN')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/super-admin/security-incidents', { cache: 'no-store' })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? 'Could not load incidents')
        setIncidents(data.incidents ?? []); setTimeline(data.timeline ?? []); setIntegrity(data.evidence_integrity ?? 'UNKNOWN')
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div className="lx-page lx-console px-5 py-10 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-3xl">
        <PageHeader title="Security Incidents" badge="Super Admin" />
        <p className="mb-5 text-sm text-white/45">Factual security cases for human review. Network, device, and approximate-location indicators do not prove identity.</p>
        <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
          Evidence integrity: <span className={integrity === 'INTACT' ? 'text-green-400' : 'text-red-400'}>{integrity}</span>
        </div>
        {error && <p className="text-red-400">{error}</p>}
        {!error && incidents.length === 0 && <p className="py-12 text-center text-white/35">No security incidents created yet.</p>}
        <div className="space-y-4">
          {incidents.map((incident) => {
            const events = timeline.filter((row) => row.incident_id === incident.id)
            return <section key={incident.id} className="lx-surface rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-white">{incident.incident_id}</h2>
                <span className="text-xs uppercase text-amber-300">{incident.severity} · {Math.round(incident.confidence * 100)}% confidence</span>
              </div>
              <p className="mt-2 text-sm text-white/80">{incident.classification}</p>
              <p className="mt-1 text-xs text-white/40">Status {incident.status} · account {incident.account_role ?? 'unverified'} / {incident.account_id ?? 'not linked'}</p>
              <div className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-2">
                <p>Rules: {incident.triggered_rules.join(', ') || 'none recorded'}</p>
                <p>Containment: {incident.containment_actions.join(', ') || 'observe'}</p>
                <p>Orders: {incident.affected_orders.join(', ') || 'none'}</p>
                <p>Payments: {incident.affected_payments.join(', ') || 'none'}</p>
                <p>Evidence hold: {incident.evidence_hold ? 'ACTIVE' : 'not active'}</p>
                <p>Next: {incident.recommended_action ?? 'human triage'}</p>
              </div>
              {incident.approximate_location && <p className="mt-3 text-xs text-white/45">Approximate location: {incident.approximate_location.label ?? 'unknown'}{incident.approximate_location.accuracy_m ? ` (±${incident.approximate_location.accuracy_m}m)` : ''}. {incident.location_accuracy_warning}</p>}
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/50">Factual timeline</h3>
              <div className="mt-2 space-y-2">
                {events.map((row) => <div key={row.security_events?.id ?? row.factual_note} className="rounded-lg bg-black/20 p-3 text-xs text-white/60">
                  <p>{row.security_events ? `${new Date(row.security_events.created_at).toLocaleString()} · ${row.security_events.event_type} · ${row.security_events.outcome ?? 'recorded'}` : row.factual_note}</p>
                  {row.security_events && <p className="mt-1 text-white/35">session {row.security_events.session_id ?? 'n/a'} · network {row.security_events.ip ?? 'n/a'} · request {row.security_events.request_id ?? 'n/a'} · {row.security_events.route ?? 'n/a'}</p>}
                </div>)}
              </div>
            </section>
          })}
        </div>
      </div>
    </div>
  )
}
