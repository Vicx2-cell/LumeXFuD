import { createSupabaseAdmin } from './supabase/server'

// Operational controls (kill switches + ops settings), stored in the `settings`
// table and read live with a short cache. Distinct from feature flags: these are
// emergency/operational levers the super-admin pulls during incidents.

export type PayoutsMode = 'auto' | 'manual' | 'frozen'

export interface PlatformControls {
  withdrawals_frozen: boolean      // stop ALL withdrawals (withdraw route enforces)
  payouts_mode: PayoutsMode        // gates the 15-min rider/vendor auto-release
  maintenance_enabled: boolean     // pause new orders platform-wide
  maintenance_message: string      // shown to users while in maintenance
  notifications_paused: boolean     // skip all WhatsApp/SMS sends
  support_phone: string            // support contact shown to users
  hours_open: string               // "07:00"
  hours_close: string              // "22:00"
  enforce_hours: boolean           // block orders outside open/close when true
  auto_cancel_minutes: number      // vendor accept window before auto-cancel (0 = off)
}

// The NORMAL operating state. Used to seed the result and to fill in any control
// whose settings row hasn't been written yet — so the platform runs normally
// before a super-admin ever touches a switch.
export const CONTROL_DEFAULTS: PlatformControls = {
  withdrawals_frozen: false,
  payouts_mode: 'auto',
  maintenance_enabled: false,
  maintenance_message: 'LumeX is undergoing quick maintenance. Please check back shortly.',
  notifications_paused: false,
  support_phone: '',
  hours_open: '07:00',
  hours_close: '22:00',
  enforce_hours: false,
  auto_cancel_minutes: 5,
}

// FAIL-SAFE state. Returned ONLY when the store is unreachable (read threw) so
// we never fail open during an outage: money fails CLOSED (payouts frozen,
// withdrawals off) and ordering locks (maintenance on, delivery off). Two
// deliberate exceptions: notifications are NOT paused (silencing OTP/transactional
// alerts on a transient blip would lock users out), and auto-cancel keeps its
// normal window (skipping it would strand PENDING orders without refund). See the
// LumeX Control spec — "fail-safe, not fail-open".
const SAFE_DEFAULTS: PlatformControls = {
  ...CONTROL_DEFAULTS,
  withdrawals_frozen: true,
  payouts_mode: 'frozen',
  maintenance_enabled: true,
}

// Setting ids (some pre-exist: withdrawals_frozen, platform_hours).
const IDS = {
  withdrawals: 'withdrawals_frozen',
  payouts: 'payouts_mode',
  maintenance: 'maintenance',
  notifications: 'notifications_paused',
  support: 'support_phone',
  hours: 'platform_hours',
  autocancel: 'auto_cancel_minutes',
} as const

type Row = { id: string; value: unknown }

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || (typeof v === 'object' && v !== null && (v as { enabled?: unknown }).enabled === true)
}

let _cache: { at: number; v: PlatformControls } | null = null
const TTL_MS = 15_000

export async function getControls(force = false): Promise<PlatformControls> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.v

  const out: PlatformControls = { ...CONTROL_DEFAULTS }
  try {
    const db = createSupabaseAdmin()
    const { data } = await db.from('settings').select('id, value').in('id', Object.values(IDS))
    const map = new Map<string, unknown>((data as Row[] ?? []).map((r) => [r.id, r.value]))

    out.withdrawals_frozen = asBool(map.get(IDS.withdrawals))
    out.notifications_paused = asBool(map.get(IDS.notifications))

    const payouts = map.get(IDS.payouts)
    const payoutsRaw = typeof payouts === 'string'
      ? payouts
      : (payouts && typeof payouts === 'object' ? (payouts as { mode?: unknown }).mode : undefined)
    if (payoutsRaw === 'auto' || payoutsRaw === 'manual' || payoutsRaw === 'frozen') {
      out.payouts_mode = payoutsRaw
    }

    const autocancel = map.get(IDS.autocancel) as { minutes?: unknown } | number | undefined
    const minutes = typeof autocancel === 'number'
      ? autocancel
      : (autocancel && typeof autocancel === 'object' ? autocancel.minutes : undefined)
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0) {
      out.auto_cancel_minutes = Math.floor(minutes)
    }

    const maint = map.get(IDS.maintenance) as { enabled?: unknown; message?: unknown } | undefined
    if (maint && typeof maint === 'object') {
      out.maintenance_enabled = maint.enabled === true
      if (typeof maint.message === 'string' && maint.message) out.maintenance_message = maint.message
    }

    const support = map.get(IDS.support) as { value?: unknown; phone?: unknown } | string | undefined
    if (typeof support === 'string') out.support_phone = support
    else if (support && typeof support === 'object') out.support_phone = String(support.phone ?? support.value ?? '')

    const hours = map.get(IDS.hours) as { open?: unknown; close?: unknown; enforce?: unknown } | undefined
    if (hours && typeof hours === 'object') {
      if (typeof hours.open === 'string') out.hours_open = hours.open
      if (typeof hours.close === 'string') out.hours_close = hours.close
      out.enforce_hours = hours.enforce === true
    }

    _cache = { at: Date.now(), v: out } // cache only successful reads
    return out
  } catch {
    // Store unreachable — fail SAFE (locked/frozen), never permissive. Don't
    // cache the failure so the next read retries the store.
    return { ...SAFE_DEFAULTS }
  }
}

export function invalidateControlsCache() { _cache = null }

export async function isNotificationsPaused(): Promise<boolean> {
  return (await getControls()).notifications_paused
}

export async function getPayoutsMode(): Promise<PayoutsMode> {
  return (await getControls()).payouts_mode
}

// Are we within open hours right now (Africa/Lagos)? Only meaningful when
// enforce_hours is on. "HH:MM" compare in campus-local time.
export function withinHours(c: PlatformControls, now: Date = new Date()): boolean {
  if (!c.enforce_hours) return true
  const lagos = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now) // "HH:MM"
  return lagos >= c.hours_open && lagos < c.hours_close
}

export { IDS as CONTROL_IDS }
