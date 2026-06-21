// Shared contact deep-link helpers (B4). Used by the rider + vendor dashboards to
// reach the customer (and each other) by WhatsApp deep link or phone — no WhatsApp
// Business API, works without CAC. A handover CODE must NEVER appear in any
// prefilled text passed here (Invariant I3).

/**
 * Normalize a Nigerian number to E.164 digits (no '+') for wa.me / tel:.
 * Accepts +234…, 234…, 0…, or a bare 10-digit subscriber number.
 */
export function toE164Digits(phone: string | null | undefined): string {
  if (!phone) return ''
  let d = phone.replace(/[^\d]/g, '')
  if (d.startsWith('0')) d = '234' + d.slice(1)
  else if (!d.startsWith('234') && d.length === 10) d = '234' + d
  return d
}

/** wa.me deep link with prefilled text (the text must not contain a code). */
export function waLink(phone: string | null | undefined, text: string): string {
  return `https://wa.me/${toE164Digits(phone)}?text=${encodeURIComponent(text)}`
}

/** tel: link to the E.164 number. */
export function telLink(phone: string | null | undefined): string {
  return `tel:+${toE164Digits(phone)}`
}
