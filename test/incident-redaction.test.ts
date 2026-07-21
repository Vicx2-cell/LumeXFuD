import { describe, expect, it } from 'vitest'
import { approximateLocationForConsole, maskIncidentIdentifier, maskNetworkIndicator } from '@/lib/incident-redaction'

describe('incident console redaction', () => {
  it('masks account and session identifiers', () => {
    expect(maskIncidentIdentifier('session-1234567890')).toBe('sessio…7890')
    expect(maskIncidentIdentifier(null)).toBeNull()
  })

  it('coarsens IPv4 and IPv6 network indicators', () => {
    expect(maskNetworkIndicator('198.51.100.42')).toBe('198.51.100.xxx')
    expect(maskNetworkIndicator('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:…')
  })

  it('drops precise coordinates and floors claimed accuracy', () => {
    const result = approximateLocationForConsole({ label: 'Campus area', accuracy_m: 3, latitude: 5.1, longitude: 7.2 })
    expect(result).toEqual({
      label: 'Campus area', accuracy_m: 100,
      warning: 'Approximate indicator only; not proof of identity or presence.',
    })
    expect(result).not.toHaveProperty('latitude')
    expect(result).not.toHaveProperty('longitude')
  })
})
