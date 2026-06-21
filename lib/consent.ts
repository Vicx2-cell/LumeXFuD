import { createSupabaseAdmin } from './supabase/server'

// ─── Consent & action-agreement layer (Invariant I8) ─────────────────────────
// Every BINDING action — anything that moves money, commits food, or accepts
// responsibility — is recorded APPEND-ONLY against the terms version in force at
// the moment of agreement. Routine reads (browse, view status, refresh) are NOT
// gated here: friction on those trains blind-ticking and destroys the record's
// value. The super admin reads this log as the dispute record.

export type ConsentRole = 'customer' | 'vendor' | 'rider'

// Canonical binding actions per role (used as the `action` column value). Keeping
// these as a closed set makes the consent log queryable and the dispute record
// legible. Add a new action here when a new binding step is introduced.
export const CONSENT_ACTIONS = {
  // Customer
  PICKUP_PLACE:        'customer.pickup.place_order',       // the 1h25m agreement
  DELIVERY_PLACE:      'customer.delivery.place_order',
  LEAVE_AT_GATE:       'customer.delivery.leave_at_gate',
  REQUEST_CANCEL:      'customer.order.request_cancel',
  // Vendor
  VENDOR_ACCEPT:       'vendor.order.accept',
  VENDOR_REJECT:       'vendor.order.reject',
  VENDOR_READY:        'vendor.order.mark_ready',
  VENDOR_HANDOVER:     'vendor.order.confirm_handover',     // code entry
  // Rider
  RIDER_ACCEPT:        'rider.delivery.accept',
  RIDER_DELIVER:       'rider.delivery.confirm',            // code entry
  RIDER_GATE_DROP:     'rider.delivery.leave_at_gate_drop',
  // Onboarding (first use of a feature)
  ONBOARD:             'onboard.terms_accept',
} as const

export type ConsentAction = (typeof CONSENT_ACTIONS)[keyof typeof CONSENT_ACTIONS]

export interface CurrentTerms {
  role: ConsentRole
  version: number
  content: string
}

/** The current (highest-version) terms for a role, or null if none seeded. */
export async function getCurrentTerms(
  role: ConsentRole,
  db: ReturnType<typeof createSupabaseAdmin> = createSupabaseAdmin(),
): Promise<CurrentTerms | null> {
  const { data } = await db
    .from('terms_versions')
    .select('role, version, content')
    .eq('role', role)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { role, version: Number(data.version), content: String(data.content) }
}

/** Just the current version number for a role (cheap; used to pin a consent). */
export async function getCurrentTermsVersion(
  role: ConsentRole,
  db: ReturnType<typeof createSupabaseAdmin> = createSupabaseAdmin(),
): Promise<number | null> {
  const t = await getCurrentTerms(role, db)
  return t?.version ?? null
}

export interface ConsentEntry {
  actorId: string
  role: ConsentRole
  action: ConsentAction
  orderId?: string | null
  /** Pin the version the actor agreed to. If omitted, the current one is read. */
  termsVersion?: number | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Append a consent row. Append-only at the DB level (trigger from migration 056),
 * so this can only ever INSERT. Never throws — a consent-write failure is logged
 * loudly (it is part of the dispute record) but must not abort the binding action
 * the user already agreed to. Returns true on a confirmed write.
 */
export async function recordConsent(entry: ConsentEntry): Promise<boolean> {
  const db = createSupabaseAdmin()
  try {
    let version = entry.termsVersion ?? null
    if (version == null) version = await getCurrentTermsVersion(entry.role, db)
    const { error } = await db.from('consent_log').insert({
      actor_id:      entry.actorId,
      role:          entry.role,
      action:        entry.action,
      order_id:      entry.orderId ?? null,
      terms_version: version,
      ip_address:    entry.ipAddress ?? null,
      user_agent:    entry.userAgent ?? null,
    })
    if (error) {
      console.error(`[consent] FAILED to record ${entry.action} for ${entry.actorId}:`, error.message)
      return false
    }
    return true
  } catch (err) {
    console.error(`[consent] FAILED to record ${entry.action} for ${entry.actorId}:`, err)
    return false
  }
}

export interface ConsentRow {
  id: string
  actor_id: string
  role: string
  action: string
  order_id: string | null
  terms_version: number | null
  agreed_at: string
}

/** Super-admin dispute record: every consent for one order, oldest first. */
export async function getConsentForOrder(orderId: string): Promise<ConsentRow[]> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('consent_log')
    .select('id, actor_id, role, action, order_id, terms_version, agreed_at')
    .eq('order_id', orderId)
    .order('agreed_at', { ascending: true })
  return (data ?? []) as ConsentRow[]
}
