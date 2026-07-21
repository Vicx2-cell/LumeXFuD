export function maskIncidentIdentifier(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function maskNetworkIndicator(value: string | null | undefined): string | null {
  if (!value) return null
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.xxx`
  if (value.includes(':')) return `${value.split(':').slice(0, 3).join(':')}:…`
  return 'Recorded (reveal through audited export)'
}

export function approximateLocationForConsole(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  return {
    label: typeof row.label === 'string' ? row.label.slice(0, 120) : 'Approximate area recorded',
    accuracy_m: typeof row.accuracy_m === 'number' && Number.isFinite(row.accuracy_m)
      ? Math.max(100, Math.round(row.accuracy_m))
      : null,
    warning: 'Approximate indicator only; not proof of identity or presence.',
  }
}
