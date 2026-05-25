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

/** Mask phone for logging: +2348012345678 → +234801*****78 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***'
  return phone.slice(0, 7) + '*****' + phone.slice(-2)
}
