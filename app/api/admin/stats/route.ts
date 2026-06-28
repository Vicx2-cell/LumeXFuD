import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { requireRole } from '@/lib/authz'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Super-admin only. Returns aggregate account counts regardless of the
// launch_counter flag. Role is verified IN CODE via the central authz gate.
export async function GET() {
  const gate = await requireRole(await getCurrentUser(), ['super_admin'], 'admin/stats')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

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
