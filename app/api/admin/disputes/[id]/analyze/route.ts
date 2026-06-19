import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { isAIAvailable, resolveProvider } from '@/lib/ai/providers'
import { parseModelJson, DisputeBrief } from '@/lib/ai/schemas'
import { DISPUTE_ANALYST_PROMPT, wrapUntrusted } from '@/lib/ai/prompts'
import { redactObject } from '@/lib/ai/guard'
import { toNaira } from '@/lib/money'

export const runtime = 'nodejs'

// AI dispute analyst — ADVISORY ONLY. Gathers an order's dispute facts, redacts
// PII, and asks Haiku for a fair, structured brief + suggested resolution. The
// human admin still clicks Refund / No Action; this never moves money or changes
// state (read-only), and the suggested resolution is not auto-applied.

type DB = ReturnType<typeof createSupabaseAdmin>

async function analyze(facts: unknown, complaint: string): Promise<DisputeBrief | null> {
  if (!(await isAIAvailable('dispute'))) return null
  const provider = await resolveProvider('dispute')
  const base = `Dispute facts (JSON):\n${JSON.stringify(facts)}\n\nCustomer's complaint:\n${wrapUntrusted(complaint || '(no description provided)')}`
  let lastErr = ''
  // One retry: bad JSON → re-ask with the validation error appended, then give up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const userText = attempt === 0 ? base : `${base}\n\nYour previous reply was invalid (${lastErr}). Return ONLY valid JSON for the schema.`
    try {
      const out = await provider.generate({
        maxTokens: 600,
        system: DISPUTE_ANALYST_PROMPT,
        userText,
        jsonMode: true,
      })
      const parsed = parseModelJson(DisputeBrief, out.text)
      if (parsed.ok) return parsed.data
      lastErr = parsed.error
    } catch (err) {
      console.error('[dispute-analyze] model error:', err)
      return null
    }
  }
  return null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`dispute-analyze:${session.phone}`, 20, 300)
  if (!rl.success) return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 })

  if (!(await isAIAvailable('dispute'))) return NextResponse.json({ error: 'AI analysis is not configured.' }, { status: 503 })

  const db: DB = createSupabaseAdmin()

  const { data: order } = await db
    .from('orders')
    .select('id, order_number, status, total_amount, subtotal, delivery_type, created_at, delivered_at, vendor_id, customer_id, payment_method')
    .eq('id', id)
    .single()
  if (!order || order.status !== 'DISPUTED') {
    return NextResponse.json({ error: 'Order not found or not in DISPUTED state' }, { status: 404 })
  }

  const [{ data: items }, { data: dispute }, { data: vendor }] = await Promise.all([
    db.from('order_items').select('name, quantity').eq('order_id', id),
    db.from('disputes').select('reason, description, created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('vendors').select('avg_rating, total_ratings').eq('id', order.vendor_id as string).maybeSingle(),
  ])

  // Customer context (counts only — no name/phone reaches the model).
  let priorDisputes = 0, totalOrders = 0, accountAgeDays: number | null = null
  if (order.customer_id) {
    const [{ data: cust }, { count }] = await Promise.all([
      db.from('customers').select('dispute_count, created_at').eq('id', order.customer_id as string).maybeSingle(),
      db.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', order.customer_id as string).eq('payment_status', 'PAID'),
    ])
    priorDisputes = Number((cust as { dispute_count?: number } | null)?.dispute_count ?? 0)
    totalOrders = count ?? 0
    const created = (cust as { created_at?: string } | null)?.created_at
    if (created) accountAgeDays = Math.round((Date.now() - new Date(created).getTime()) / 86_400_000)
  }

  const deliveredAt = order.delivered_at ? new Date(order.delivered_at as string) : null
  const disputeAt = dispute?.created_at ? new Date(dispute.created_at as string) : null
  const minsToDispute = deliveredAt && disputeAt ? Math.round((disputeAt.getTime() - deliveredAt.getTime()) / 60000) : null

  // Facts for the model — IDs/counts only, scrubbed of any stray PII.
  const facts = redactObject({
    order_number: order.order_number,
    order_total_naira: Math.round(toNaira(order.total_amount as number)),
    food_subtotal_naira: Math.round(toNaira((order.subtotal as number) ?? 0)),
    delivery_type: order.delivery_type,
    payment_method: order.payment_method,
    minutes_from_delivery_to_dispute: minsToDispute,
    items: ((items ?? []) as Array<{ name: string; quantity: number }>).map((i) => ({ name: i.name, qty: i.quantity })),
    dispute_reason: dispute?.reason ?? 'unknown',
    customer: { total_paid_orders: totalOrders, prior_disputes: priorDisputes, account_age_days: accountAgeDays },
    vendor: { avg_rating: (vendor as { avg_rating?: number } | null)?.avg_rating ?? null, total_ratings: (vendor as { total_ratings?: number } | null)?.total_ratings ?? null },
  })

  const brief = await analyze(facts, (dispute?.description as string) ?? '')
  if (!brief) return NextResponse.json({ error: 'Could not analyze this dispute right now. Decide manually.' }, { status: 503 })

  return NextResponse.json({ brief })
}
