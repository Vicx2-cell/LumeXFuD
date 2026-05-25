/** Convert kobo (integer) to naira float */
export function toNaira(kobo: bigint | number): number {
  return Number(kobo) / 100
}

/** Convert naira float to kobo integer (always floors) */
export function toKobo(naira: number): number {
  return Math.floor(naira * 100)
}

/** Format kobo amount as ₦1,234.56 string */
export function formatPrice(kobo: bigint | number): string {
  return '₦' + toNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
