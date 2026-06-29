import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { requireRole } from '@/lib/authz'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { sendText } from '@/lib/whatsapp'
import { safeNormalizePhone } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Super-admin WhatsApp inbox API. Role verified IN CODE.
//   GET                 → list conversations currently in human mode
//   GET ?phone=+234...   → the full message thread for one conversation
//   POST {action:reply}  → send a text reply (and keep the conversation human)
//   POST {action:handback} → flip the conversation back to bot mode

export async function GET(req: NextRequest) {
  const gate = await requireRole(await getCurrentUser(), ['super_admin'], 'admin/whatsapp')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const db = createSupabaseAdmin()
  const phone = req.nextUrl.searchParams.get('phone')

  if (phone) {
    const canonical = safeNormalizePhone(phone) ?? phone
    // Thread + the full CONTEXT PACKAGE so the human picks up exactly where the
    // bot left off: conversation (incl. live cart), customer profile, and the
    // customer's most recent active order.
    const [{ data: conv }, { data: messages }, { data: customer }] = await Promise.all([
      db.from('whatsapp_conversations').select('phone, role, state, mode, cart, active_order_id, updated_at').eq('phone', canonical).maybeSingle(),
      db
        .from('whatsapp_messages')
        .select('id, direction, msg_type, body, created_at')
        .eq('phone', canonical)
        .order('created_at', { ascending: true })
        .limit(200),
      db
        .from('customers')
        .select('id, name, phone, default_delivery_address, created_at, suspended_until')
        .eq('phone', canonical)
        .is('deleted_at', null)
        .maybeSingle(),
    ])

    // Most recent live order for this customer (any non-terminal/just-placed state).
    let order: unknown = null
    if (customer?.id) {
      const { data: o } = await db
        .from('orders')
        .select('order_number, status, payment_status, total_amount, delivery_type, delivery_address, created_at, vendors(shop_name)')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      order = o ?? null
    }

    return NextResponse.json({ conversation: conv ?? null, messages: messages ?? [], customer: customer ?? null, order })
  }

  // Inbox list (conversations needing a human) + pending applications.
  const [{ data: convs }, { data: applications }] = await Promise.all([
    db.from('whatsapp_conversations').select('phone, role, state, mode, updated_at').eq('mode', 'human').order('updated_at', { ascending: false }).limit(100),
    db.from('whatsapp_applications').select('id, phone, kind, name, details, status, created_at').eq('status', 'NEW').order('created_at', { ascending: false }).limit(50),
  ])

  // Attach a last-message preview per conversation (small N, fine to loop).
  const list = await Promise.all(
    (convs ?? []).map(async (c: { phone: string; role: string | null; state: string; mode: string; updated_at: string }) => {
      const { data: last } = await db
        .from('whatsapp_messages')
        .select('direction, body, created_at')
        .eq('phone', c.phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { ...c, last }
    }),
  )

  return NextResponse.json({ conversations: list, applications: applications ?? [] })
}

const bodySchema = z
  .object({
    action: z.enum(['reply', 'handback']),
    phone: z.string().min(6).max(20),
    text: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .refine((b) => b.action !== 'reply' || (b.text && b.text.trim().length > 0), { message: 'text is required to reply' })

export async function POST(req: NextRequest) {
  const gate = await requireRole(await getCurrentUser(), ['super_admin'], 'admin/whatsapp')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const session = gate.session

  const rl = await rateLimitGeneric(`admin-whatsapp:${session.userId ?? session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  const { action, phone, text } = parsed.data
  const canonical = safeNormalizePhone(phone) ?? phone
  const db = createSupabaseAdmin()

  if (action === 'reply') {
    const result = await sendText(canonical, text!.trim())
    if (!result.ok) return NextResponse.json({ error: `WhatsApp send failed: ${result.error ?? 'unknown'}` }, { status: 502 })
    await db.from('whatsapp_messages').insert({ phone: canonical, direction: 'out', msg_type: 'text', body: text!.trim() })
    // Keep the conversation in human mode and bump its activity timestamp.
    await db.from('whatsapp_conversations').update({ mode: 'human', updated_at: new Date().toISOString() }).eq('phone', canonical)
    await superAudit({ actor_id: session.phone, actor_role: session.role, action: 'whatsapp_reply', target_table: 'whatsapp_conversations', target_id: canonical })
    return NextResponse.json({ ok: true })
  }

  // handback → bot
  await db.from('whatsapp_conversations').update({ mode: 'bot', state: 'IDLE', updated_at: new Date().toISOString() }).eq('phone', canonical)
  await superAudit({ actor_id: session.phone, actor_role: session.role, action: 'whatsapp_handback', target_table: 'whatsapp_conversations', target_id: canonical })
  return NextResponse.json({ ok: true })
}
