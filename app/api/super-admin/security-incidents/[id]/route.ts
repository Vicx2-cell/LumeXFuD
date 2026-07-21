import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'
import { recordSecurityEvent } from '@/lib/security-events'

const idSchema = z.string().uuid()
const updateInput = z.object({
  status: z.enum(['INVESTIGATING', 'CONTAINED', 'RESOLVED', 'FALSE_POSITIVE']),
  factual_note: z.string().trim().min(3).max(500),
  containment_actions: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })
  const parsedId = idSchema.safeParse((await params).id)
  const parsed = updateInput.safeParse(await req.json().catch(() => null))
  if (!parsedId.success || !parsed.success) return json({ error: 'Invalid case update' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const eventId = await recordSecurityEvent({
    eventType: 'incident_status_changed', severity: 'info', surface: 'security_incident',
    actorId: session.userId ?? session.phone, actorRole: session.role,
    sessionId: session.sessionId, ip, userAgent: req.headers.get('user-agent'),
    requestId: context.requestId, correlationId: context.correlationId,
    route: req.nextUrl.pathname, method: req.method,
    resourceType: 'security_incident', resourceId: parsedId.data,
    outcome: 'human_reviewed', detail: { new_status: parsed.data.status },
  })
  if (!eventId) return json({ error: 'Could not preserve case evidence' }, { status: 503 })

  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('update_security_incident_case', {
    p_incident_id: parsedId.data, p_status: parsed.data.status, p_event_id: eventId,
    p_actor_id: session.userId ?? session.phone, p_request_id: context.requestId,
    p_factual_note: parsed.data.factual_note,
    p_actions: parsed.data.containment_actions ?? null,
  })
  if (error) return json({ error: 'Could not update incident' }, { status: 500 })
  if (!data) return json({ error: 'Incident not found' }, { status: 404 })
  return json({ success: true, status: parsed.data.status })
}
