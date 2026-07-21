import { evaluateRisk, type RiskEvaluation, type RiskSignal } from './risk-engine'
import type { SessionRole } from './session'

const SUPER_ONLY_ADMIN_PATHS = new Set([
  '/api/admin/block', '/api/admin/feature-flags', '/api/admin/stats',
  '/api/admin/wallet-adjust', '/api/admin/whatsapp',
])

export function privilegedApiRoles(pathname: string): SessionRole[] | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path.startsWith('/api/super-admin/')) return ['super_admin']
  if (SUPER_ONLY_ADMIN_PATHS.has(path)) return ['super_admin']
  if (path.startsWith('/api/admin/')) return ['admin', 'super_admin']
  if (path === '/api/paystack/refund' || path === '/api/wallet/freeze' || path === '/api/wallet/unfreeze') {
    return ['admin', 'super_admin']
  }
  return null
}

export function evaluateAdminAccessRisk(facts: {
  wrongRole?: boolean
  sessionIpChanged?: boolean
  userAgentChanged?: boolean
}): RiskEvaluation {
  const signals: RiskSignal[] = []
  if (facts.wrongRole) signals.push({
    code: 'privileged_route_wrong_role', category: 'authorization',
    weight: 65, confidence: 0.95, strength: 'strong', corroborated: true,
  })
  if (facts.sessionIpChanged) signals.push({
    code: 'admin_session_network_changed', category: 'device_session',
    weight: 15, confidence: 0.45, strength: 'weak',
  })
  if (facts.userAgentChanged) signals.push({
    code: 'admin_session_user_agent_changed', category: 'device_session',
    weight: 15, confidence: 0.55, strength: 'weak',
  })
  return evaluateRisk(signals)
}
