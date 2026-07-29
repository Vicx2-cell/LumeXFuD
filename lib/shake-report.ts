export const SHAKE_THRESHOLD = 25
export const SHAKE_COOLDOWN_MS = 5_000

export function isReportShake({
  x,
  y,
  z,
  now,
  lastTriggeredAt,
}: {
  x: number | null | undefined
  y: number | null | undefined
  z: number | null | undefined
  now: number
  lastTriggeredAt: number
}) {
  const magnitude = Math.hypot(x ?? 0, y ?? 0, z ?? 0)
  return magnitude >= SHAKE_THRESHOLD && now - lastTriggeredAt >= SHAKE_COOLDOWN_MS
}
