import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

interface PendingReset {
  id: string
  phone: string
  name: string
  role: string
  pin_reset_requested_at: string | null
}

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentUser()
    if (!session || (session.role !== 'admin' && session.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const db = createSupabaseAdmin()

    // Query each table for pending resets in parallel
    const [customers, vendors, riders, admins] = await Promise.all([
      db.from('customers')
        .select('id, phone, name, pin_reset_requested_at')
        .eq('pin_reset_pending', true)
        .is('deleted_at', null),
      db.from('vendors')
        .select('id, phone, owner_name, pin_reset_requested_at')
        .eq('pin_reset_pending', true)
        .is('deleted_at', null),
      db.from('riders')
        .select('id, phone, full_name, pin_reset_requested_at')
        .eq('pin_reset_pending', true)
        .is('deleted_at', null),
      db.from('admins')
        .select('id, phone, name, pin_reset_requested_at')
        .eq('pin_reset_pending', true),
    ])

    const pending: PendingReset[] = [
      ...(customers.data ?? []).map((u) => ({
        id:                     u.id,
        phone:                  u.phone,
        name:                   u.name ?? '',
        role:                   'customer',
        pin_reset_requested_at: u.pin_reset_requested_at ?? null,
      })),
      ...(vendors.data ?? []).map((u) => ({
        id:                     u.id,
        phone:                  u.phone,
        name:                   u.owner_name ?? '',
        role:                   'vendor',
        pin_reset_requested_at: u.pin_reset_requested_at ?? null,
      })),
      ...(riders.data ?? []).map((u) => ({
        id:                     u.id,
        phone:                  u.phone,
        name:                   u.full_name ?? '',
        role:                   'rider',
        pin_reset_requested_at: u.pin_reset_requested_at ?? null,
      })),
      ...(admins.data ?? []).map((u) => ({
        id:                     u.id,
        phone:                  u.phone,
        name:                   u.name ?? '',
        role:                   'admin',
        pin_reset_requested_at: u.pin_reset_requested_at ?? null,
      })),
    ]

    // Most recent requests first
    pending.sort((a, b) => {
      const ta = a.pin_reset_requested_at ? new Date(a.pin_reset_requested_at).getTime() : 0
      const tb = b.pin_reset_requested_at ? new Date(b.pin_reset_requested_at).getTime() : 0
      return tb - ta
    })

    return NextResponse.json({ pending, total: pending.length })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
