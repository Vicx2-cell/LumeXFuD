export const GROUP_ORDER_STATES = [
  'DRAFT',
  'OPEN',
  'LOCKED',
  'VALIDATING',
  'AWAITING_PAYMENT',
  'PLACED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
] as const

export type GroupOrderState = (typeof GROUP_ORDER_STATES)[number]

const transitions: Record<GroupOrderState, readonly GroupOrderState[]> = {
  DRAFT: ['OPEN', 'CANCELLED', 'EXPIRED'],
  OPEN: ['VALIDATING', 'CANCELLED', 'EXPIRED'],
  VALIDATING: ['OPEN', 'LOCKED', 'FAILED', 'EXPIRED'],
  LOCKED: ['AWAITING_PAYMENT', 'OPEN', 'CANCELLED', 'EXPIRED', 'FAILED'],
  AWAITING_PAYMENT: ['PLACED', 'LOCKED', 'FAILED', 'EXPIRED'],
  PLACED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: ['OPEN', 'CANCELLED', 'EXPIRED'],
}

export function canTransitionGroupOrder(from: GroupOrderState, to: GroupOrderState): boolean {
  return transitions[from].includes(to)
}

export function isGroupEditable(status: string, expiresAt: string, now = Date.now()): boolean {
  return status === 'OPEN' && Date.parse(expiresAt) > now
}

export function validateGroupDeadline(deadline: string, now = Date.now()): string | null {
  const timestamp = Date.parse(deadline)
  if (!Number.isFinite(timestamp)) return 'Choose a valid deadline'
  if (timestamp < now + 15 * 60_000) return 'Deadline must be at least 15 minutes away'
  if (timestamp > now + 24 * 60 * 60_000) return 'Deadline cannot be more than 24 hours away'
  return null
}

export function participantBudgetExceeded(subtotalKobo: number, budgetKobo: number | null): boolean {
  return budgetKobo !== null && subtotalKobo > budgetKobo
}
