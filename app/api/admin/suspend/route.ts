import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone, safeNormalizePhone } from '@/lib/phone'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { isPhoneBlocked } from '@/lib/blocklist'

// Suspend / unsuspend ANY single account (customer, vendor or rider).
// Suspension is orthogonal to the vendor/rider `is_active` approval flag — it
// blocks login (any role) + ordering (customer), and is cleared independently.

const INDEFINITE = '2099-01-01T00:00:00.000Z'

type Found = { table: 'customers' | 'vendors' | 'riders'; role: string; id: string; name: string; suspended_until: string | null; suspend_reason: string | null }

async function lookup(db: ReturnType<typeof createSupabaseAdmin>, phone: string): Promise<Found | null> {
  const targets: Array<{ table: Found['table']; role: string; nameCol: string }> = [
    { table: 'vendors', role: 'vendor', nameCol: 'owner_name' },
    { table: 'riders', role: 'rider', nameCol: 'full_name' },
    { table: 'customers', role: 'customer', nameCol: 'name' },
  ]
  for (const t of targets) {
    const { data } = await db.from(t.table).select(`id, ${t.nameCol}, suspended_until, suspend_reason`).eq('phone', phone).maybeSingle()
    if (data) {
      const r = data as unknown as Record<string, unknown>
      return {
        table: t.table, role: t.role, id: String(r.id),
        name: String(r[t.nameCol] ?? '—'),
        suspended_until: (r.suspended_until as string | null) ?? null,
        suspend_reason: (r.suspend_reason as string | null) ?? null,
      }
    }
  }
  return null
}

function isSuspended(f: Found): boolean {
  return !!f.suspended_until && new Date(f.suspended_until).getTime() > Date.now()
}

async function authAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (!['admin', 'super_admin'].includes(session.role)) return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

// GET ?phone=… — look up an account + its current suspension status.
export async function GET(req: NextRequest) {
  const { err } = await authAdmin()
  if (err) return err
  const raw = req.nextUrl.searchParams.get('phone') ?? ''
  let phone: string
  try { phone = normalizePhone(raw) } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }

  const db = createSupabaseAdmin()
  const found = await lookup(db, phone)
  const blocked = await isPhoneBlocked(phone)
  if (!found) return NextResponse.json({ found: false, blocked })
  return NextResponse.json({ found: true, role: found.role, name: found.name, suspended: isSuspended(found), reason: found.suspend_reason, blocked })
}

const postInput = z.object({
  phone:  z.string().min(7).max(20),
  action: z.enum(['suspend', 'unsuspend']),
  reason: z.string().trim().max(300).optional(),
})

export async function POST(req: NextRequest) {
  const { err, session } = await authAdmin()
  if (err || !session) return err!

  const rl = await rateLimitGeneric(`admin-suspend:${session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = postInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }

  const db = createSupabaseAdmin()
  const found = await lookup(db, phone)
  if (!found) return NextResponse.json({ error: 'No account found for that number' }, { status: 404 })

  // Never let an admin suspend a super-admin / the platform owner via this tool.
  if (found.role === 'customer' && phone === safeNormalizePhone(process.env.SUPER_ADMIN_PHONE)) {
    return NextResponse.json({ error: 'That account cannot be suspended here' }, { status: 403 })
  }

  const suspend = parsed.data.action === 'suspend'
  const update: Record<string, unknown> = {
    suspended_until: suspend ? INDEFINITE : null,
    suspend_reason:  suspend ? (parsed.data.reason ?? null) : null,
    updated_at: new Date().toISOString(),
  }
  // A suspended VENDOR must also disappear from the storefront, listings and SEO,
  // which all gate on `is_active`. `suspended_until` alone only blocks login, so
  // the shop stayed visible. Flip the visibility flag + close the store in
  // lockstep (mirrors the approve/suspend PATCH), and restore on unsuspend.
  if (found.table === 'vendors') {
    update.is_active = !suspend
    update.status = suspend ? 'CLOSED' : 'OPEN'
  }
  const { error: upErr } = await db.from(found.table).update(update).eq('id', found.id)
  if (upErr) return NextResponse.json({ error: 'Could not update the account' }, { status: 500 })

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: suspend ? 'account_suspended' : 'account_unsuspended',
    target_table: found.table,
    target_id: found.id,
    new_value: { role: found.role, reason: suspend ? (parsed.data.reason ?? null) : null },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, role: found.role, name: found.name, suspended: suspend })
}
