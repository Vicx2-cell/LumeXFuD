import { createSupabaseAdmin } from './supabase/server'

// Phone blocklist — a super-admin can permanently bar a number from registering.
// Stored in the blocked_phones table (migration 063). Callers pass an E.164
// phone (normalize via lib/phone first). Reads fail OPEN: if the blocklist is
// momentarily unreadable we'd rather let a sign-up through than block every
// sign-up platform-wide (a banned user slipping through during an outage is the
// lesser harm, and the ban still blocks their login).

export async function isPhoneBlocked(phone: string): Promise<boolean> {
  try {
    const db = createSupabaseAdmin()
    const { data } = await db.from('blocked_phones').select('phone').eq('phone', phone).maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export async function blockPhone(phone: string, reason: string | null, blockedBy: string): Promise<void> {
  const db = createSupabaseAdmin()
  await db.from('blocked_phones').upsert(
    { phone, reason, blocked_by: blockedBy, created_at: new Date().toISOString() },
    { onConflict: 'phone' },
  )
}

export async function unblockPhone(phone: string): Promise<void> {
  const db = createSupabaseAdmin()
  await db.from('blocked_phones').delete().eq('phone', phone)
}

export interface BlockedRow { phone: string; reason: string | null; blocked_by: string | null; created_at: string }

export async function listBlocked(): Promise<BlockedRow[]> {
  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('blocked_phones')
      .select('phone, reason, blocked_by, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    return (data ?? []) as BlockedRow[]
  } catch {
    return []
  }
}
