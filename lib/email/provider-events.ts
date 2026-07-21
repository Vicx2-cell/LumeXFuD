export type ProviderDeliveryStatus = 'SENT' | 'DELIVERED' | 'DELIVERY_DELAYED' | 'BOUNCED' | 'SUPPRESSED' | 'COMPLAINED' | 'FAILED'

export function providerEventStatus(type: string): ProviderDeliveryStatus | null {
  switch (type) {
    case 'email.sent': return 'SENT'
    case 'email.delivered': return 'DELIVERED'
    case 'email.delivery_delayed': return 'DELIVERY_DELAYED'
    case 'email.bounced': return 'BOUNCED'
    case 'email.suppressed': return 'SUPPRESSED'
    case 'email.complained': return 'COMPLAINED'
    case 'email.failed': return 'FAILED'
    default: return null
  }
}

export function providerEventErrorCode(type: string): string | null {
  const status = providerEventStatus(type)
  return status && ['BOUNCED', 'SUPPRESSED', 'COMPLAINED', 'FAILED'].includes(status) ? type.replace('email.', 'provider_') : null
}
