import { sendSms, sendWhatsAppTemplate, whatsAppTemplateConfigured } from './sendchamp'

interface NotifyParams {
  to: string
  message: string
}

/**
 * Send a user-facing notification.
 *
 * Channel: WhatsApp (approved template) when SENDCHAMP_WA_SENDER +
 * SENDCHAMP_WA_TEMPLATE_CODE are set, otherwise Sendchamp SMS. WhatsApp failures
 * fall back to SMS so a template/sender hiccup never drops a notification.
 *
 * Kept under the historical name `sendWhatsAppWithFallback` so the ~20 call
 * sites stay untouched.
 *
 * Honors the super-admin "Pause notifications" control — when paused this
 * no-ops, so a cost spike or misfire can be stopped platform-wide in one tap.
 * Every user-facing notification routes through here, so this is the one gate.
 */
export async function sendWhatsAppWithFallback(params: NotifyParams): Promise<void> {
  try {
    const { isNotificationsPaused } = await import('./controls')
    if (await isNotificationsPaused()) return
  } catch {
    // controls unreadable — fail open and still send.
  }

  // Prefer WhatsApp (approved template) when configured; SMS otherwise / on failure.
  if (whatsAppTemplateConfigured()) {
    try {
      await sendWhatsAppTemplate(params.to, params.message)
      return
    } catch (err) {
      console.error('[notify] WhatsApp template failed, falling back to SMS:', err instanceof Error ? err.message : err)
    }
  }
  await sendSms(params.to, params.message)
}

// Notification copy lives alongside the sender so callers can import both from
// one module (mirrors the old lib/termii templates split).
export { renderTemplate, TEMPLATES } from './notify-templates'
export type { TemplateName } from './notify-templates'
