import { createSupabaseAdmin } from './supabase/server'

type DB = ReturnType<typeof createSupabaseAdmin>

export interface BusyModeConfig {
  threshold: number
  bufferMinutes: number
}

export interface BusyModeThrottle {
  preparingCount: number
  threshold: number
  bufferMinutes: number
  appliedBufferMinutes: number
}

export const BUSY_MODE_SETTING_IDS = {
  threshold: 'busy_mode_preparing_threshold',
  buffer: 'busy_mode_prep_buffer_minutes',
} as const

const DEFAULT_CONFIG: BusyModeConfig = {
  threshold: 5,
  bufferMinutes: 10,
}

function wholeMinutes(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
}

function valueNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null
  return wholeMinutes((value as Record<string, unknown>)[key])
}

export function busyModeBuffer(config: BusyModeConfig, preparingCount: number): number {
  const threshold = wholeMinutes(config.threshold) ?? DEFAULT_CONFIG.threshold
  const buffer = wholeMinutes(config.bufferMinutes) ?? DEFAULT_CONFIG.bufferMinutes
  if (buffer <= 0) return 0
  return preparingCount > threshold ? buffer : 0
}

export async function getBusyModeConfig(db: DB = createSupabaseAdmin()): Promise<BusyModeConfig> {
  const { data } = await db
    .from('settings')
    .select('id, value')
    .in('id', Object.values(BUSY_MODE_SETTING_IDS))

  const rows = (data ?? []) as Array<{ id: string; value: unknown }>
  const byId = new Map(rows.map((r) => [r.id, r.value]))
  const threshold =
    valueNumber(byId.get(BUSY_MODE_SETTING_IDS.threshold), 'count') ??
    valueNumber(byId.get(BUSY_MODE_SETTING_IDS.threshold), 'value') ??
    DEFAULT_CONFIG.threshold
  const bufferMinutes =
    valueNumber(byId.get(BUSY_MODE_SETTING_IDS.buffer), 'minutes') ??
    valueNumber(byId.get(BUSY_MODE_SETTING_IDS.buffer), 'value') ??
    DEFAULT_CONFIG.bufferMinutes

  return { threshold, bufferMinutes }
}

export async function getBusyModeThrottle(
  db: DB,
  vendorId: string,
): Promise<BusyModeThrottle> {
  const [config, preparing] = await Promise.all([
    getBusyModeConfig(db),
    db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', vendorId)
      .eq('status', 'PREPARING'),
  ])
  const preparingCount = Number(preparing.count ?? 0)
  const appliedBufferMinutes = busyModeBuffer(config, preparingCount)

  return {
    preparingCount,
    threshold: config.threshold,
    bufferMinutes: config.bufferMinutes,
    appliedBufferMinutes,
  }
}
