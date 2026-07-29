import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { evaluatePromotion, type Promotion } from '@/lib/promotion'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const inputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  subtotal_kobo: z.number().int().nonnegative(),
  delivery_fee_kobo: z.number().int().nonnegative(),
  platform_fee_kobo: z.number().int().nonnegative(),
  vendor_id: z.string().uuid().optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  campus_id: z.string().uuid().optional().nullable(),
  is_group_order: z.boolean().optional().default(false),
})

function toPromotion(row: Record<string, unknown>): Promotion {
  return {
    discountType: row.discount_type as Promotion['discountType'],
    valueKobo: Number(row.value_kobo ?? 0),
    percentageBps: Number(row.percentage_bps ?? 0),
    percentageCapKobo: row.percentage_cap_kobo == null ? null : Number(row.percentage_cap_kobo),
    minimumSubtotalKobo: Number(row.minimum_subtotal_kobo ?? 0),
    startsAt: String(row.starts_at),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    status: row.status as Promotion['status'],
    firstOrderOnly: Boolean(row.first_order_only),
    groupOrderOnly: Boolean(row.group_order_only),
    eligibleVendorId: row.eligible_vendor_id == null ? null : String(row.eligible_vendor_id),
    eligibleCategory: row.eligible_category == null ? null : String(row.eligible_category),
    eligibleCampusId: row.eligible_campus_id == null ? null : String(row.eligible_campus_id),
    totalUsesLimit: row.total_uses_limit == null ? null : Number(row.total_uses_limit),
    usesPerCustomer: row.uses_per_customer == null ? null : Number(row.uses_per_customer),
  }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid promo quote request' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const promoCode = parsed.data.code.toUpperCase()

  const [{ data: promotionRow }, session] = await Promise.all([
    db
      .from('promotions')
      .select('id, code, promotion_kind, discount_type, value_kobo, percentage_bps, percentage_cap_kobo, minimum_subtotal_kobo, eligible_vendor_id, eligible_category, eligible_campus_id, first_order_only, group_order_only, starts_at, expires_at, total_uses_limit, uses_per_customer, funding_source, status')
      .eq('code', promoCode)
      .maybeSingle(),
    getCurrentUser(),
  ])

  if (!promotionRow) {
    return NextResponse.json({
      matched: false,
      promo_code: promoCode,
      discount_kobo: 0,
      reason: 'Promotion code not found.',
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  }

  const promotion = toPromotion(promotionRow as Record<string, unknown>)

  const [vendorRow, customerId] = await Promise.all([
    parsed.data.vendor_id
      ? db.from('vendors').select('id, city_id, zone_id').eq('id', parsed.data.vendor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    session?.role === 'customer' && session.userId
      ? Promise.resolve(session.userId)
      : Promise.resolve(null),
  ])

  let isFirstOrder = false
  let totalUses = 0
  let customerUses = 0
  if (customerId) {
    const [paidOrders, promoRedemptions] = await Promise.all([
      db.from('orders').select('id').eq('customer_id', customerId).eq('payment_status', 'PAID'),
      db.from('promo_redemptions').select('id').eq('promotion_id', promotionRow.id).in('status', ['RESERVED', 'COMMITTED']),
    ])
    isFirstOrder = (paidOrders.data?.length ?? 0) === 0
    totalUses = promoRedemptions.data?.length ?? 0
    customerUses = (await db.from('promo_redemptions').select('id').eq('promotion_id', promotionRow.id).eq('customer_id', customerId).in('status', ['RESERVED', 'COMMITTED'])).data?.length ?? 0
  } else {
    const [promoRedemptions] = await Promise.all([
      db.from('promo_redemptions').select('id').eq('promotion_id', promotionRow.id).in('status', ['RESERVED', 'COMMITTED']),
    ])
    totalUses = promoRedemptions.data?.length ?? 0
  }

  const vendor = vendorRow.data as { city_id?: string | null; zone_id?: string | null } | null
  const category = parsed.data.category ?? null
  const campusId = parsed.data.campus_id ?? vendor?.city_id ?? null

  const quote = evaluatePromotion(promotion, {
    subtotalKobo: parsed.data.subtotal_kobo,
    deliveryFeeKobo: parsed.data.delivery_fee_kobo,
    platformFeeKobo: parsed.data.platform_fee_kobo,
    isFirstOrder,
    isGroupOrder: parsed.data.is_group_order,
    vendorId: parsed.data.vendor_id ?? null,
    category,
    campusId,
    totalUses,
    customerUses,
    now: new Date(),
  })

  return NextResponse.json({
    matched: true,
    promo_code: promoCode,
    promotion: {
      code: promotionRow.code,
      discount_type: promotionRow.discount_type,
      promotion_kind: promotionRow.promotion_kind,
      funding_source: promotionRow.funding_source,
      status: promotionRow.status,
    },
    eligible: quote.eligible,
    discount_kobo: quote.discountKobo,
    reason: quote.reason ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
