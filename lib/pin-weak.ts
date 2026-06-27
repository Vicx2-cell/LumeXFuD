// Client-safe PIN strength check. Mirrors the server's validatePin (lib/pin-auth.ts,
// which is the source of truth) so the UI can reject a weak PIN INSTANTLY — no
// round-trip, no generic "registration failed" after a 2s wait. pin-auth.ts
// imports WEAK_PINS from here so the two never drift.

export const WEAK_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999',
  '123456', '654321', '012345', '234567', '121212', '123123',
  '112233', '102030', '246810', '135791',
])

/** Returns a friendly error string if the PIN is weak/invalid, else null. */
export function pinStrengthError(pin: string): string | null {
  if (!/^[0-9]{6}$/.test(pin)) return 'Your PIN must be exactly 6 digits.'
  if (WEAK_PINS.has(pin)) return 'That PIN is too easy to guess — pick a less obvious one.'
  const digits = pin.split('').map((d) => Number(d))
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1)
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1)
  if (ascending || descending) return 'Avoid straight runs like 123456 — pick something less predictable.'
  return null
}
