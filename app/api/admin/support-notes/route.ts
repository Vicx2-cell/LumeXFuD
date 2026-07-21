import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { normalizePhone, safeNormalizePhone } from '@/lib/phone'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const subjectType = z.enum(['customer', 'vendor', 'rider', 'order', 'payment', 'dispute', 'contact_case', 'phone'])

const postInput = z.object({
  subject_type: subjectType,
  subject_id: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  note: z.string().trim().min(3).max(2000),
  pinned: z.boolean().optional(),
}).refine((value) => value.subject_id || value.phone, {
  message: 'subject_id or phone is required',
})

async function requireAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!['admin', 'super_admin'].includes(session.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const type = req.nextUrl.searchParams.get('subject_type')
  const subjectId = req.nextUrl.searchParams.get('subject_id')?.trim()
  const rawPhone = req.nextUrl.searchParams.get('phone')?.trim()
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 25) || 25, 1), 100)

  const parsedType = type ? subjectType.safeParse(type) : null
  if (type && !parsedType?.success) return NextResponse.json({ error: 'Invalid subject type' }, { status: 400 })

  let phone: string | null = null
  if (rawPhone) {
    phone = safeNormalizePhone(rawPhone)
    if (!phone) return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  let query = db
    .from('support_notes')
    .select('id, subject_type, subject_id, phone, note, pinned, created_by, created_by_role, created_at')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (parsedType?.success) query = query.eq('subject_type', parsedType.data)
  if (subjectId) query = query.eq('subject_id', subjectId)
  if (phone) query = query.eq('phone', phone)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [], limit })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const rl = await rateLimitGeneric(`support-notes:${auth.session.userId ?? auth.session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = postInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  let phone: string | null = null
  if (parsed.data.phone) {
    try { phone = normalizePhone(parsed.data.phone) } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }
  }

  const row = {
    subject_type: parsed.data.subject_type,
    subject_id: parsed.data.subject_id ?? null,
    phone,
    note: parsed.data.note,
    pinned: parsed.data.pinned ?? false,
    created_by: auth.session.phone,
    created_by_role: auth.session.role,
  }

  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('support_notes')
    .insert(row)
    .select('id, subject_type, subject_id, phone, note, pinned, created_by, created_by_role, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit({
    actor_id: auth.session.phone,
    actor_role: auth.session.role,
    action: 'support_note_created',
    target_table: 'support_notes',
    target_id: String(data?.id ?? row.subject_id ?? row.phone ?? 'unknown'),
    new_value: { subject_type: row.subject_type, subject_id: row.subject_id, phone: row.phone, pinned: row.pinned },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    user_agent: req.headers.get('user-agent') ?? undefined,
  })

  return NextResponse.json({ note: data }, { status: 201 })
}
