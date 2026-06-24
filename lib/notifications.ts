import { createSupabaseAdmin } from './supabase/server'

// Recipient identity for the in-app notification center. Matches the
// notifications.user_type CHECK and the session roles (upper-cased).
export type NotifUserType = 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'ADMIN' | 'SUPER_ADMIN'

export interface InAppNotification {
  id: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/** Map a session role to the notifications.user_type value. */
export function roleToUserType(role: string): NotifUserType {
  switch (role) {
    case 'vendor': return 'VENDOR'
    case 'rider': return 'RIDER'
    case 'admin': return 'ADMIN'
    case 'super_admin': return 'SUPER_ADMIN'
    default: return 'CUSTOMER'
  }
}

/**
 * Persist an in-app notification (the bell + list). Safe to call fire-and-forget:
 * it never throws — a failed insert must not break the order/payment flow that
 * triggered it. Sending the WhatsApp/SMS + push copy is the caller's job (see
 * lib/notify-user.ts), this is purely the in-app record.
 */
export async function notifyInApp(params: {
  userId: string
  userType: NotifUserType
  title: string
  body?: string
  link?: string
  template?: string
}): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    await db.from('notifications').insert({
      user_id: params.userId,
      user_type: params.userType,
      channel: 'in_app',
      template: params.template ?? 'IN_APP',
      title: params.title,
      body: params.body ?? null,
      link: params.link ?? null,
      status: 'SENT',
      sent_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[notifications] in-app insert failed:', e instanceof Error ? e.message : e)
  }
}

/** Newest-first in-app notifications for the bell list. */
export async function listInApp(userId: string, limit = 30): Promise<InAppNotification[]> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('notifications')
    .select('id, title, body, link, read_at, created_at')
    .eq('user_id', userId)
    .eq('channel', 'in_app')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100))
  return (data ?? []) as InAppNotification[]
}

/** Unread count for the bell badge. */
export async function unreadCount(userId: string): Promise<number> {
  const db = createSupabaseAdmin()
  const { count } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('channel', 'in_app')
    .is('read_at', null)
  return count ?? 0
}

/**
 * Mark notifications read. With no ids, marks ALL of the user's unread in-app
 * notifications read. Always scoped to user_id so one user can never touch
 * another's rows (the API route passes the session id).
 */
export async function markRead(userId: string, ids?: string[]): Promise<void> {
  const db = createSupabaseAdmin()
  let q = db
    .from('notifications')
    .update({ read_at: new Date().toISOString(), status: 'READ' })
    .eq('user_id', userId)
    .eq('channel', 'in_app')
    .is('read_at', null)
  if (ids && ids.length > 0) q = q.in('id', ids)
  await q
}
