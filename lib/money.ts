/** Convert kobo (integer) to naira float */
export function toNaira(kobo: bigint | number): number {
  return Number(kobo) / 100
}

/** Convert naira float to kobo integer (always floors) */
export function toKobo(naira: number): number {
  return Math.floor(naira * 100)
}

/** True when a value is a finite integer kobo amount. */
export function isValidKoboAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

/**
 * Format kobo amount as ₦1,234.56.
 *
 * IMPORTANT: manual grouping, NOT toLocaleString('en-NG'). The locale can be
 * flaky on some browsers, so this stays deterministic and safe.
 */
export function formatPrice(kobo: bigint | number): string {
  const naira = toNaira(kobo)
  if (!Number.isFinite(naira)) return ''
  const [intPart, decRaw] = Math.abs(naira).toFixed(2).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const dec = decRaw === '00' ? '' : '.' + decRaw.replace(/0+$/, '')
  return (naira < 0 ? '-₦' : '₦') + grouped + dec
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Locale-free "5 Jun 2026". */
export function formatDate(input: string | number | Date): string {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Locale-free "5 Jun, 2:30 PM". */
export function formatDateTime(input: string | number | Date): string {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h < 12 ? 'AM' : 'PM'
  h = h % 12 === 0 ? 12 : h % 12
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h}:${m} ${ampm}`
}
