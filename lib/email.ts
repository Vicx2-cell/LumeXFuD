// Backward-compatible import surface. New code should import from lib/email/send-email.
export { normalizeEmail, sendEmail } from './email/send-email'
export type { EmailSendResult, EmailTransport, SendEmailInput } from './email/send-email'
