import { createSupabaseAdmin } from './supabase/server'

// Broadcast announcements — a super-admin posts messages that show on users'
// screens as dismissible banners. MULTIPLE can be live at once (each targets its
// own audience + schedule and is cleared independently). Stored as a JSON ARRAY
// in the existing `settings` table under one key (no new table/migration).

export type AnnouncementAudience = 'ALL' | 'CUSTOMER' | 'VENDOR' | 'RIDER'
export type AnnouncementLevel = 'info' | 'warning' | 'success'

export interface Announcement {
  id: string            // uuid — dismissal + delete key
  title: string | null
  message: string
  audience: AnnouncementAudience
  level: AnnouncementLevel
  scheduled_at: string | null  // ISO; show from this moment (null/past = now)
  expires_at: string | null    // ISO; auto-hide after this (null = until dismissed/cleared)
  created_at: string
  created_by?: string
}

export const ANNOUNCEMENT_LIST_ID = 'announcement.list'

function normalize(raw: unknown): Announcement | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<Announcement>
  if (typeof v.message !== 'string' || !v.message || !v.id) return null
  return {
    id: String(v.id),
    title: v.title ?? null,
    message: v.message,
    audience: (v.audience as AnnouncementAudience) ?? 'ALL',
    level: (v.level as AnnouncementLevel) ?? 'info',
    scheduled_at: v.scheduled_at ?? null,
    expires_at: v.expires_at ?? null,
    created_at: v.created_at ?? '',
    created_by: v.created_by,
  }
}

/** Every stored announcement (newest first), regardless of schedule window. */
export async function readAnnouncements(): Promise<Announcement[]> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('id', ANNOUNCEMENT_LIST_ID)
    .maybeSingle()
  const v = (data as { value?: unknown } | null)?.value
  const arr = Array.isArray(v) ? v : []
  return arr
    .map(normalize)
    .filter((a): a is Announcement => a !== null)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

/** Overwrite the stored list (read-modify-write by callers). */
export async function writeAnnouncements(list: Announcement[], updatedBy: string): Promise<boolean> {
  const db = createSupabaseAdmin()
  const { error } = await db.from('settings').upsert(
    { id: ANNOUNCEMENT_LIST_ID, value: list, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  return !error
}

// Is the announcement within its scheduled window right now? Visibility is
// computed at read time — no cron: a scheduled banner just appears on the next
// client poll once `scheduled_at` passes, and disappears once `expires_at` does.
export function isVisibleNow(ann: Announcement, now: number = Date.now()): boolean {
  if (ann.scheduled_at && now < new Date(ann.scheduled_at).getTime()) return false
  if (ann.expires_at && now >= new Date(ann.expires_at).getTime()) return false
  return true
}

/** Did this announcement's expiry pass more than `graceMs` ago? (for pruning) */
export function isLongExpired(ann: Announcement, graceMs = 24 * 3_600_000, now = Date.now()): boolean {
  return !!ann.expires_at && now - new Date(ann.expires_at).getTime() > graceMs
}

/** Does an announcement aimed at `audience` reach a viewer with this role? */
export function audienceMatches(audience: AnnouncementAudience, role: string | null): boolean {
  if (audience === 'ALL') return true
  // Staff always see announcements (so the founder can preview any audience).
  if (role === 'admin' || role === 'super_admin') return true
  if (audience === 'CUSTOMER') return role === 'customer'
  if (audience === 'VENDOR') return role === 'vendor'
  if (audience === 'RIDER') return role === 'rider'
  return false
}
