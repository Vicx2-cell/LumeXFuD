import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getAnthropic, MODELS } from '@/lib/ai/client'
import { parseModelJson, DisputeConcierge } from '@/lib/ai/schemas'
import { DISPUTE_CONCIERGE_PROMPT, wrapUntrusted } from '@/lib/ai/prompts'
import { redactObject } from '@/lib/ai/guard'
import { toNaira } from '@/lib/money'

// Customer-facing intake + admin triage in one pass. Runs when a dispute is
// filed: returns Lumi's empathetic reply for the student AND an impartial brief
// for the admin. ADVISORY ONLY — never moves money. Returns null on any failure
// (missing key, bad order, model error) so the dispute flow degrades cleanly.

type DB = ReturnType<typeof createSupabaseAdmin>

export interface ConciergeResult {
  customerReply: string
  brief: {
    summary: string
    customer_claim: string
    key_facts: string[]
    risk_flags: string[]
    suggested_resolution: 'REFUND' | 'NO_ACTION' | 'PARTIAL' | 'NEEDS_MORE_INFO'
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  }
}

/** Build the redacted fact pack the model reasons over (IDs/counts only). */
async function gatherFacts(db: DB, orderId: string): Promise<{ facts: unknown; complaint: string } | null> {
  const { data: order } = await db
    .from('orders')
    .select('id, order_number, status, total_amount, subtotal, delivery_type, created_at, delivered_at, vendor_id, customer_id, payment_method')
    .eq('id', orderId)
    .single()
  if (!order || order.status !== 'DISPUTED') return null

  const [{ data: items }, { data: dispute }, { data: vendor }] = await Promise.all([
    db.from('order_items').select('name, quantity').eq('order_id', orderId),
    db.from('disputes').select('reason, description, created_at').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('vendors').select('avg_rating, total_ratings').eq('id', order.vendor_id as string).maybeSingle(),
  ])

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

  return { facts, complaint: (dispute?.description as string) ?? (dispute?.reason as string) ?? '' }
}

export async function runConcierge(db: DB, orderId: string): Promise<ConciergeResult | null> {
  const anthropic = await getAnthropic()
  if (!anthropic) return null

  const gathered = await gatherFacts(db, orderId)
  if (!gathered) return null

  const base = `Dispute facts (JSON):\n${JSON.stringify(gathered.facts)}\n\nStudent's complaint:\n${wrapUntrusted(gathered.complaint || '(no description provided)')}`
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = attempt === 0 ? base : `${base}\n\nYour previous reply was invalid (${lastErr}). Return ONLY valid JSON for the schema.`
    try {
      const res = await anthropic.messages.create({
        model: MODELS.fast,
        max_tokens: 700,
        system: DISPUTE_CONCIERGE_PROMPT,
        messages: [{ role: 'user', content }],
      })
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      const parsed = parseModelJson(DisputeConcierge, text)
      if (parsed.ok) {
        const { customer_reply, ...brief } = parsed.data
        return { customerReply: customer_reply, brief }
      }
      lastErr = parsed.error
    } catch (err) {
      console.error('[dispute-concierge] model error:', err)
      return null
    }
  }
  return null
}
