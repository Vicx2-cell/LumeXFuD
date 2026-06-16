import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Super-admin only. Returns aggregate account counts regardless of the
// launch_counter flag. Role is verified IN CODE — never via RLS.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const countOf = async (table: 'customers' | 'vendors' | 'riders') => {
    const { count } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
    return count ?? 0
  }

  const [customers, vendors, riders] = await Promise.all([
    countOf('customers'),
    countOf('vendors'),
    countOf('riders'),
  ])

  return NextResponse.json({ customers, vendors, riders })
}
