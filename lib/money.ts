/** Convert kobo (integer) to naira float */
export function toNaira(kobo: bigint | number): number {
  return Number(kobo) / 100
}

/** Convert naira float to kobo integer (always floors) */
export function toKobo(naira: number): number {
  return Math.floor(naira * 100)
}

/**
 * Format kobo amount as ₦1,234.56.
 *
 * IMPORTANT: manual grouping, NOT toLocaleString('en-NG'). The 'en-NG' locale
 * crashes the iOS Safari renderer ("page couldn't load") on any page that calls
 * it — which, since formatPrice is used app-wide, took out the dashboard, orders,
 * cart, wallet, etc. on iPhone. Locale-free formatting is identical visually and
 * safe on every browser.
 */
export function formatPrice(kobo: bigint | number): string {
  const naira = toNaira(kobo)
  const [intPart, decRaw] = Math.abs(naira).toFixed(2).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const dec = decRaw === '00' ? '' : '.' + decRaw.replace(/0+$/, '')
  return (naira < 0 ? '-₦' : '₦') + grouped + dec
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Locale-free "5 Jun 2026" (avoids the iOS-crashing toLocaleDateString('en-NG')). */
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
