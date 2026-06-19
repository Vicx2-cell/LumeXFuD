import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone, safeNormalizePhone } from '@/lib/phone'
import { audit, superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { blockPhone, unblockPhone, isPhoneBlocked, listBlocked } from '@/lib/blocklist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ban / unban a phone number. A ban = blocklist the number (can never register
// again, enforced in the auth routes) + suspend any existing account for it.
// Reversible. Super-admin ONLY — strictly more destructive than suspend.
//
// We never hard-delete the user row: that would orphan wallet balances, break
// reconciliation and erase the audit trail. Suspend + blocklist achieves the
// real goal (they can't get in and can't come back) while preserving the ledger.

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (session.role !== 'super_admin') return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

const INDEFINITE = '2099-01-01T00:00:00.000Z'

type Found = { table: 'customers' | 'vendors' | 'riders'; role: string; id: string }

// A phone can exist in more than one table (admin-create doesn't cross-check), so
// a ban must hit EVERY matching account, not just the first found.
async function lookupAll(db: ReturnType<typeof createSupabaseAdmin>, phone: string): Promise<Found[]> {
  const targets: Array<{ table: Found['table']; role: string }> = [
    { table: 'vendors', role: 'vendor' },
    { table: 'riders', role: 'rider' },
    { table: 'customers', role: 'customer' },
  ]
  const found: Found[] = []
  for (const t of targets) {
    const { data } = await db.from(t.table).select('id').eq('phone', phone).maybeSingle()
    if (data) found.push({ table: t.table, role: t.role, id: String((data as { id: string }).id) })
  }
  return found
}

// GET — the current blocklist (super-admin).
export async function GET() {
  const { err } = await requireSuperAdmin()
  if (err) return err
  return NextResponse.json({ blocked: await listBlocked() })
}

const postInput = z.object({
  phone:  z.string().min(7).max(20),
  action: z.enum(['block', 'unblock']),
  reason: z.string().trim().max(300).optional(),
})

export async function POST(req: NextRequest) {
  const { err, session } = await requireSuperAdmin()
  if (err || !session) return err!

  const rl = await rateLimitGeneric(`admin-block:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = postInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }

  // Never let the platform owner / operational admin numbers be banned via this tool.
  const privileged = new Set<string>()
  for (const raw of [process.env.SUPER_ADMIN_PHONE, process.env.ADMIN_PHONE]) {
    if (!raw) continue
    privileged.add(raw)
    const n = safeNormalizePhone(raw); if (n) privileged.add(n)
  }
  if (privileged.has(phone)) {
    return NextResponse.json({ error: 'That number cannot be banned.' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const found = await lookupAll(db, phone)
  const ban = parsed.data.action === 'block'
  const reason = parsed.data.reason ?? null
  const now = new Date().toISOString()

  if (ban) {
    await blockPhone(phone, reason, session.phone)
    // Suspend EVERY account on this number so they're locked out immediately.
    for (const acct of found) {
      await db.from(acct.table).update({
        suspended_until: INDEFINITE,
        suspend_reason: reason ?? 'Account banned',
        updated_at: now,
      }).eq('id', acct.id)
    }
  } else {
    await unblockPhone(phone)
    // Lift the suspension on every account so the number is fully reinstated.
    for (const acct of found) {
      await db.from(acct.table).update({
        suspended_until: null,
        suspend_reason: null,
        updated_at: now,
      }).eq('id', acct.id)
    }
  }

  const roles = found.map((f) => f.role)
  const auditEntry = {
    actor_id: session.phone,
    actor_role: session.role,
    action: ban ? 'phone_banned' : 'phone_unbanned',
    target_table: found[0]?.table ?? 'blocked_phones',
    target_id: found[0]?.id ?? phone,
    new_value: { reason: ban ? reason : null, had_account: found.length > 0, roles },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  }
  await audit(auditEntry)
  await superAudit(auditEntry)

  return NextResponse.json({ success: true, blocked: await isPhoneBlocked(phone), had_account: found.length > 0, roles })
}
