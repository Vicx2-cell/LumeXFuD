/**
 * Shared operational limits. Monetary amounts are integers in the unit named
 * by the constant; persistence and provider calls must use kobo.
 */
export const WALLET_WITHDRAWAL_LIMITS_NAIRA = {
  minimum: 500,
  maximumPerTransaction: 25_000,
} as const
