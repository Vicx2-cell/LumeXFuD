import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

const idSchema = z.string().uuid()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })
  const parsedId = idSchema.safeParse((await params).id)
  if (!parsedId.success) return json({ error: 'Invalid incident ID' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: incident, error } = await db.from('security_incidents')
    .select('id, incident_id, severity, confidence, classification, status, account_id, account_role, affected_orders, affected_payments, triggered_rules, containment_actions, approximate_location, location_accuracy_warning, recommended_action, evidence_hold, evidence_hold_reason, evidence_held_at, created_at')
    .eq('id', parsedId.data).maybeSingle()
  if (error) return json({ error: 'Could not load incident' }, { status: 500 })
  if (!incident) return json({ error: 'Incident not found' }, { status: 404 })

  const [{ data: timeline }, { data: custody }, { data: broken }] = await Promise.all([
    db.from('security_incident_events').select('factual_note, added_at, security_events(id, created_at, event_type, severity, actor_id, actor_role, session_id, ip, user_agent, request_id, correlation_id, route, method, resource_type, resource_id, outcome, detail, prev_hash, row_hash)').eq('incident_id', parsedId.data).order('added_at'),
    db.from('security_evidence_custody').select('action, actor_id, request_id, export_hash, detail, created_at').eq('incident_id', parsedId.data).order('created_at'),
    db.rpc('security_events_verify_chain'),
  ])
  const evidencePackage = {
    export_purpose: 'Prepared for authorized human review. No external submission has occurred.',
    generated_at: new Date().toISOString(),
    deployment_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    facts: { incident, timeline: timeline ?? [], custody: custody ?? [] },
    inferences: [],
    integrity: { security_event_chain: broken?.length ? 'BROKEN' : 'INTACT', first_gap: broken?.[0] ?? null },
    disclosure: { automatic_submission: false, human_authorization_required: true, minimum_necessary_review_required: true },
  }
  const body = JSON.stringify(evidencePackage, null, 2)
  const hash = crypto.createHash('sha256').update(body).digest('hex')
  const { error: custodyError } = await db.from('security_evidence_custody').insert({
    incident_id: parsedId.data, action: 'EXPORTED', actor_id: session.userId ?? session.phone,
    request_id: context.requestId, export_hash: hash, detail: { format: 'json', bytes: Buffer.byteLength(body) },
  })
  if (custodyError) return json({ error: 'Could not record evidence export' }, { status: 500 })
  const response = new NextResponse(body, { headers: {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${incident.incident_id}-evidence.json"`,
    'X-Evidence-SHA256': hash,
  } })
  return applyRequestContext(response, context)
}
