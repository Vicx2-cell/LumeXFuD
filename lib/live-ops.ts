// ─── Live Operations: order anomaly engine ────────────────────────────────────
// Pure, DB-free classification of an in-flight order into a severity + a set of
// human-readable flags, computed entirely from columns we already store (status,
// per-stage timestamps, payment status, the customer's dispute history). The
// admin Live Ops board renders this; the engine itself is unit-tested.
//
// Philosophy (calm by default, loud on anomaly): a healthy order shows no flags.
// A flag appears only when an order is behaving in a way that needs a human —
// stuck too long in a stage, unassigned, in transit too long, progressing while
// unpaid, disputed, or tied to a high-dispute customer.

export type OpsSeverity = 'critical' | 'warn' | 'none'

export interface OpsFlag {
  code: string
  severity: Exclude<OpsSeverity, 'none'>
  label: string
}

// The active statuses Live Ops watches (everything between placed and settled).
export const LIVE_STATUSES = [
  'PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY',
  'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'DISPUTED',
] as const

export type LiveStatus = (typeof LIVE_STATUSES)[number]

// Minimal shape the classifier needs. The API maps DB rows (with joins) into this.
export interface LiveOrderInput {
  status: string
  payment_status: string | null
  created_at: string
  vendor_accepted_at: string | null
  preparing_at: string | null
  ready_at: string | null
  rider_assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  rider_id: string | null
  customer_dispute_count: number
}

// Per-stage "too long" thresholds in MINUTES: [warn, critical].
// Tuned to the platform's own promises: vendors must accept within 5 min, target
// delivery is under 25 min (CLAUDE.md), the dispute/auto-complete window is 15 min.
const STAGE_THRESHOLDS: Record<string, { warn: number; crit: number; ts: keyof LiveOrderInput; label: string }> = {
  PENDING:        { warn: 4,  crit: 6,  ts: 'created_at',        label: 'awaiting vendor' },
  VENDOR_ACCEPTED:{ warn: 6,  crit: 12, ts: 'vendor_accepted_at',label: 'not preparing yet' },
  PREPARING:      { warn: 30, crit: 45, ts: 'preparing_at',      label: 'preparing' },
  READY:          { warn: 8,  crit: 15, ts: 'ready_at',          label: 'waiting for rider' },
  RIDER_ASSIGNED: { warn: 12, crit: 20, ts: 'rider_assigned_at', label: 'rider not picked up' },
  PICKED_UP:      { warn: 20, crit: 35, ts: 'picked_up_at',      label: 'in transit' },
  DELIVERED:      { warn: 30, crit: 90, ts: 'delivered_at',      label: 'awaiting completion' },
}

const RISKY_CUSTOMER_DISPUTES = 3

function tsOf(o: LiveOrderInput, key: keyof LiveOrderInput): number | null {
  const v = o[key]
  if (typeof v !== 'string' || !v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

export interface OpsClassification {
  severity: OpsSeverity
  flags: OpsFlag[]
  /** When the order entered its current stage (ms epoch), for the live timer. */
  stage_since: number
  /** Minutes spent in the current stage. */
  age_min: number
}

/**
 * Classify one in-flight order. Returns its overall severity (the worst of its
 * flags) plus every flag, and how long it has been in its current stage.
 */
export function classifyOrder(o: LiveOrderInput, nowMs: number): OpsClassification {
  const flags: OpsFlag[] = []
  const stage = STAGE_THRESHOLDS[o.status]
  const stageSince = (stage ? tsOf(o, stage.ts) : null) ?? tsOf(o, 'created_at') ?? nowMs
  const ageMin = Math.max(0, Math.floor((nowMs - stageSince) / 60_000))

  // 1. Disputed — always needs a human.
  if (o.status === 'DISPUTED') {
    flags.push({ code: 'DISPUTED', severity: 'critical', label: 'Disputed — resolve now' })
  }

  // 2. Stuck too long in the current stage.
  if (stage) {
    if (ageMin >= stage.crit) {
      flags.push({ code: `STUCK_${o.status}`, severity: 'critical', label: `Stuck ${ageMin}m — ${stage.label}` })
    } else if (ageMin >= stage.warn) {
      flags.push({ code: `SLOW_${o.status}`, severity: 'warn', label: `${ageMin}m — ${stage.label}` })
    }
  }

  // 3. READY with no rider assigned — supply gap, escalates with the wait.
  if (o.status === 'READY' && !o.rider_id) {
    const sev: OpsFlag['severity'] = ageMin >= 15 ? 'critical' : 'warn'
    if (!flags.some((f) => f.code.startsWith('STUCK_READY') || f.code.startsWith('SLOW_READY'))) {
      flags.push({ code: 'UNASSIGNED', severity: sev, label: `No rider for ${ageMin}m` })
    } else {
      flags.push({ code: 'UNASSIGNED', severity: sev, label: 'No rider assigned' })
    }
  }

  // 4. Progressing while unpaid — money risk. Anything past the pre-payment gate
  //    should be PAID; if it isn't, the order is moving on unconfirmed money.
  if (o.payment_status !== 'PAID' && o.status !== 'PENDING') {
    flags.push({ code: 'UNPAID', severity: 'critical', label: `Unpaid (${o.payment_status ?? 'unknown'})` })
  }

  // 5. High-dispute customer — elevated fraud/abuse risk on this order.
  if ((o.customer_dispute_count ?? 0) >= RISKY_CUSTOMER_DISPUTES) {
    flags.push({ code: 'RISKY_CUSTOMER', severity: 'warn', label: `Customer has ${o.customer_dispute_count} disputes` })
  }

  const severity: OpsSeverity =
    flags.some((f) => f.severity === 'critical') ? 'critical'
    : flags.some((f) => f.severity === 'warn') ? 'warn'
    : 'none'

  return { severity, flags, stage_since: stageSince, age_min: ageMin }
}
