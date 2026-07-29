/**
 * Formats a numeric value only when it is actually finite.
 *
 * Database and JSON response types are not runtime guarantees. Returning null
 * lets callers render an honest unavailable state instead of inventing zero.
 */
export function formatNullableNumber(
  value: number | null | undefined,
  fractionDigits = 1,
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value.toFixed(fractionDigits)
}

export function formatDistanceKm(
  value: number | null | undefined,
  fractionDigits = 2,
): string | null {
  const formatted = formatNullableNumber(value, fractionDigits)
  return formatted === null || value! < 0 ? null : `${formatted} km`
}
