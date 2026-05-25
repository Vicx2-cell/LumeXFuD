import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseAdmin()

  let recipientType: string
  switch (session.role) {
    case 'customer': recipientType = 'CUSTOMER'; break
    case 'vendor': recipientType = 'VENDOR'; break
    case 'rider': recipientType = 'RIDER'; break
    case 'admin':
    case 'super_admin': recipientType = 'ADMIN'; break
    default: return NextResponse.json({ error: 'Invalid role' }, { status: 403 })
  }

  const { data } = await db
    .from('order_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('order_id', id)
    .eq('recipient_type', recipientType)
    .is('read_at', null)
    .select('id')

  return NextResponse.json({ marked_read: data?.length ?? 0 })
}
