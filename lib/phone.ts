import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js'

/**
 * Normalize a Nigerian phone number to E.164 format.
 * Accepts: 08012345678, +2348012345678, 2348012345678
 * Returns: +2348012345678
 * Throws: Error if invalid or not a Nigerian number.
 */
export function normalizePhone(input: string): string {
  const cleaned = input.replace(/\s/g, '')

  let withCountry = cleaned
  if (cleaned.startsWith('0')) {
    withCountry = '+234' + cleaned.slice(1)
  } else if (cleaned.startsWith('234') && !cleaned.startsWith('+')) {
    withCountry = '+' + cleaned
  }

  if (!isValidPhoneNumber(withCountry, 'NG')) {
    throw new Error(`Invalid Nigerian phone number: ${input}`)
  }

  const parsed = parsePhoneNumber(withCountry, 'NG')
  return parsed.format('E.164')
}

/**
 * Normalize to E.164, returning null instead of throwing on invalid/empty input.
 * Use when comparing configured phones (env vars) that may be stored in any
 * format (08.., 234.., +234.., stray whitespace) so the comparison is
 * format-agnostic rather than a brittle raw-string match.
 */
export function safeNormalizePhone(input: string | undefined | null): string | null {
  if (!input) return null
  try {
    return normalizePhone(input)
  } catch {
    return null
  }
}

/** Mask phone for logging: +2348012345678 → +234801*****78 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***'
  return phone.slice(0, 7) + '*****' + phone.slice(-2)
}
