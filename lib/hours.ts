// Pure formatter for platform opening hours. "HH:MM" (24h, Africa/Lagos) →
// friendly "7am – 10pm". No server imports, so it's safe to use in both server
// components and the client bundle (unlike lib/controls, which pulls in the
// service-role client).

function fmtTime(t: string): string {
  const [hStr, mStr] = (t ?? '').split(':')
  let h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (!Number.isFinite(h)) return t
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12
  if (h === 0) h = 12
  const mm = Number.isFinite(m) && m > 0 ? `:${String(m).padStart(2, '0')}` : ''
  return `${h}${mm}${ampm}`
}

export function formatHoursRange(open: string, close: string): string {
  return `${fmtTime(open)} – ${fmtTime(close)}`
}
