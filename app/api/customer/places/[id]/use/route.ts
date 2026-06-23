import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { placeToAddress } from '@/lib/saved-places'

// POST /api/customer/places/[id]/use — record that a saved place is being reused
// for the next order (bumps use_count + last_used_at so the list self-orders by
// genuine usage) and returns the single-line address to pre-fill the cart.
// Ownership-scoped: the bump RPC and the lookup both filter on customer_id.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseAdmin()
  const cid = session.userId ?? (
    (await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()).data as { id: string } | null
  )?.id
  if (!cid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: place } = await db
    .from('saved_places')
    .select('id, label, landmark')
    .eq('id', id)
    .eq('customer_id', cid)
    .maybeSingle()
  if (!place) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.rpc('touch_saved_place', { p_customer_id: cid, p_place_id: id })

  const p = place as { label: string; landmark: string | null }
  return NextResponse.json({ address: placeToAddress(p) })
}
