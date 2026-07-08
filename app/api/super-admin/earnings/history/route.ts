import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { z } from 'zod'

const VALID_TYPES = [
  'FOOD_MARKUP',
  'DELIVERY_CUT',
  'VENDOR_SUBSCRIPTION',
  'WALLET_TOPUP_FLOAT',
  'RIDER_BONUS_COST',
  'TOPUP_BONUS_COST',
  'REFUND_COST',
  'LATE_DELIVERY_CREDIT_COST',
] as const

const querySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type:  z.enum(VALID_TYPES).optional(),
  from:  z.string().optional(),   // ISO date string
  to:    z.string().optional(),
})

// GET /api/super-admin/earnings/history
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query params', details: parsed.error.flatten() }, { status: 400 })
  }

  const { page, limit, type, from, to } = parsed.data
  const db = createSupabaseAdmin()

  let q = db
    .from('platform_earnings')
    .select('id, type, amount_kobo, description, order_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (type) q = q.eq('type', type)
  if (from) q = q.gte('created_at', from)
  if (to)   q = q.lte('created_at', to)

  const { data, count, error } = await q
  if (error) {
    console.error('[earnings/history] DB error:', error.message)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({
    records:    data ?? [],
    total:      count ?? 0,
    page,
    limit,
    total_pages: Math.ceil((count ?? 0) / limit),
  })
}
