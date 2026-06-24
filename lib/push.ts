import webpush from 'web-push'
import { createSupabaseAdmin } from './supabase/server'

// Web Push (VAPID). Real browser push so vendors/riders get the new-order alert
// even when the tab/PWA is closed — the difference between a 2-minute and a
// 20-minute accept. Keys:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — public, used by the client to subscribe
//   VAPID_PRIVATE_KEY             — server-only, signs the push
//   VAPID_SUBJECT                 — mailto: or https: contact (push services require it)
// Generate once with:  npx web-push generate-vapid-keys

let configured = false

function ensureConfigured(): boolean {
  if (configured) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@lumexfud.com.ng'
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Push to every device a user has subscribed. Fire-and-forget safe (never
 * throws). Expired endpoints (404/410) are pruned so the table self-cleans.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return
  try {
    const db = createSupabaseAdmin()
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (!subs || subs.length === 0) return

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url ?? '/',
      tag: payload.tag,
    })

    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
            body
          )
          await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id)
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode
          if (code === 404 || code === 410) {
            // Subscription gone (user uninstalled / cleared site data) — prune it.
            await db.from('push_subscriptions').delete().eq('id', s.id)
          }
        }
      })
    )
  } catch (e) {
    console.error('[push] send failed:', e instanceof Error ? e.message : e)
  }
}
