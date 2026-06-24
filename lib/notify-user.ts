import { sendWhatsAppWithFallback } from './notify'
import { notifyInApp, type NotifUserType } from './notifications'
import { sendPushToUser } from './push'

/**
 * Single fan-out for a user-facing event. Writes the in-app notification (bell +
 * list), fires a Web Push (alert when the app is closed), AND sends the
 * WhatsApp/SMS copy — through the one super-admin "pause notifications" gate that
 * sendWhatsAppWithFallback already honours.
 *
 * Use this for NEW notification points. The ~20 legacy call sites still call
 * sendWhatsAppWithFallback directly; migrate them to notifyUser when touched so
 * they also light up the bell.
 *
 * The in-app write is awaited (one cheap insert, and it never throws); push +
 * WhatsApp are fire-and-forget so a slow provider never blocks the request.
 */
export async function notifyUser(params: {
  userId: string
  userType: NotifUserType
  phone?: string | null
  title: string
  body: string
  link?: string
  /** Override the WhatsApp/SMS text; defaults to "title — body". */
  sms?: string
  /** Skip the WhatsApp/SMS copy (in-app + push only). */
  inAppOnly?: boolean
}): Promise<void> {
  const { userId, userType, phone, title, body, link, sms, inAppOnly } = params

  await notifyInApp({ userId, userType, title, body, link })

  void sendPushToUser(userId, { title, body, url: link }).catch(() => {})

  if (!inAppOnly && phone) {
    const text = sms ?? `${title} — ${body}`
    void sendWhatsAppWithFallback({ to: phone, message: text }).catch(() => {})
  }
}
