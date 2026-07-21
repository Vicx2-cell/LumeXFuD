import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { createRequestContext, applyRequestContext } from '@/lib/request-context'
import { approximateLocationForConsole, maskIncidentIdentifier, maskNetworkIndicator } from '@/lib/incident-redaction'

const createInput = z.object({
  event_id: z.number().int().positive(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  classification: z.string().trim().min(3).max(120),
  account_id: z.string().trim().max(200).optional(),
  account_role: z.string().trim().max(40).optional(),
  triggered_rules: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  containment_actions: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  evidence_hold: z.boolean().default(false),
  hold_reason: z.string().trim().min(3).max(300).optional(),
  recommended_action: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.evidence_hold && !value.hold_reason) ctx.addIssue({ code: 'custom', message: 'Hold reason required', path: ['hold_reason'] })
})

export async function GET(req: NextRequest) {
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })
  const db = createSupabaseAdmin()
  const { data: incidents, error } = await db.from('security_incidents')
    .select('id, incident_id, severity, confidence, classification, status, account_id, account_role, affected_orders, affected_payments, triggered_rules, containment_actions, approximate_location, location_accuracy_warning, recommended_action, evidence_hold, created_at')
    .order('created_at', { ascending: false }).limit(50)
  if (error) return json({ error: 'Could not load incidents' }, { status: 500 })
  const ids = (incidents ?? []).map((row: { id: string }) => row.id)
  const { data: timeline } = ids.length ? await db.from('security_incident_events')
    .select('incident_id, factual_note, added_at, security_events(id, created_at, event_type, severity, actor_id, actor_role, session_id, ip, user_agent, request_id, correlation_id, route, method, resource_type, resource_id, outcome, detail, row_hash)')
    .in('incident_id', ids).order('added_at', { ascending: true }) : { data: [] }
  const { data: broken } = await db.rpc('security_events_verify_chain')
  if (ids.length) {
    const { error: custodyError } = await db.from('security_evidence_custody').insert(ids.map((incidentId: string) => ({
      incident_id: incidentId, action: 'VIEWED', actor_id: session.userId ?? session.phone,
      request_id: context.requestId, detail: { scope: 'incident_list' },
    })))
    if (custodyError) return json({ error: 'Could not record evidence access' }, { status: 500 })
  }
  const maskedIncidents = (incidents ?? []).map((incident: Record<string, unknown>) => ({
    ...incident,
    account_id: maskIncidentIdentifier(incident.account_id as string | null),
    approximate_location: approximateLocationForConsole(incident.approximate_location),
  }))
  const maskedTimeline = (timeline ?? []).map((row: Record<string, unknown>) => {
    const event = row.security_events as Record<string, unknown> | null
    return { ...row, security_events: event ? {
      ...event,
      actor_id: maskIncidentIdentifier(event.actor_id as string | null),
      session_id: maskIncidentIdentifier(event.session_id as string | null),
      ip: maskNetworkIndicator(event.ip as string | null),
      user_agent: event.user_agent ? 'Recorded (reveal through audited export)' : null,
      resource_id: maskIncidentIdentifier(event.resource_id as string | null),
    } : null }
  })
  return json({ incidents: maskedIncidents, timeline: maskedTimeline, evidence_integrity: broken?.length ? 'BROKEN' : 'INTACT' })
}

export async function POST(req: NextRequest) {
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })
  const parsed = createInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid incident facts' }, { status: 400 })
  const incidentId = `LXSI-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('create_security_incident', {
    p_incident_id: incidentId, p_event_id: parsed.data.event_id,
    p_actor_id: session.userId ?? session.phone, p_severity: parsed.data.severity,
    p_confidence: parsed.data.confidence, p_classification: parsed.data.classification,
    p_account_id: parsed.data.account_id ?? null, p_account_role: parsed.data.account_role ?? null,
    p_rules: parsed.data.triggered_rules, p_actions: parsed.data.containment_actions,
    p_evidence_hold: parsed.data.evidence_hold, p_hold_reason: parsed.data.hold_reason ?? null,
    p_recommended_action: parsed.data.recommended_action ?? null, p_request_id: context.requestId,
  })
  if (error) return json({ error: 'Could not create incident' }, { status: 500 })
  return json({ id: data, incident_id: incidentId }, { status: 201 })
}
