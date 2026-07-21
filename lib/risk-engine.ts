export type RiskCategory =
  | 'authentication'
  | 'authorization'
  | 'payment'
  | 'order_abuse'
  | 'device_session'
  | 'bot'
  | 'admin'

export type RiskStrength = 'weak' | 'moderate' | 'strong'

export interface RiskSignal {
  code: string
  category: RiskCategory
  weight: number
  confidence: number
  strength: RiskStrength
  corroborated?: boolean
}

export type RiskAction =
  | 'observe'
  | 'rate_limit'
  | 'require_reauthentication'
  | 'revoke_session'
  | 'restrict_sensitive_actions'
  | 'freeze_financial_operations'
  | 'create_evidence_hold'
  | 'alert_security_admin'

export interface RiskEvaluation {
  score: number
  confidence: number
  categoryScores: Record<RiskCategory, number>
  actions: RiskAction[]
  triggeredRules: string[]
}

const CATEGORIES: RiskCategory[] = [
  'authentication', 'authorization', 'payment', 'order_abuse',
  'device_session', 'bot', 'admin',
]

const STRENGTH_CAP: Record<RiskStrength, number> = {
  weak: 15,
  moderate: 40,
  strong: 70,
}

const emptyScores = (): Record<RiskCategory, number> => Object.fromEntries(
  CATEGORIES.map((category) => [category, 0]),
) as Record<RiskCategory, number>

/** Pure, category-based evaluation. It never permanently bans an account. */
export function evaluateRisk(signals: RiskSignal[]): RiskEvaluation {
  const categoryScores = emptyScores()
  let weightedConfidence = 0
  let totalContribution = 0

  for (const signal of signals) {
    const confidence = Math.max(0, Math.min(1, signal.confidence))
    const raw = Math.max(0, signal.weight) * confidence
    const cap = signal.corroborated ? STRENGTH_CAP[signal.strength] : Math.min(40, STRENGTH_CAP[signal.strength])
    const contribution = Math.min(raw, cap)
    categoryScores[signal.category] = Math.min(100, categoryScores[signal.category] + contribution)
    weightedConfidence += contribution * confidence
    totalContribution += contribution
  }

  const activeCategories = CATEGORIES.filter((category) => categoryScores[category] >= 25)
  const crossCategoryBonus = activeCategories.length >= 3 ? 20 : activeCategories.length >= 2 ? 10 : 0
  const score = Math.min(100, Math.round(Math.max(0, ...Object.values(categoryScores)) + crossCategoryBonus))
  const confidence = totalContribution > 0
    ? Math.round((weightedConfidence / totalContribution) * 100) / 100
    : 0

  const actions: RiskAction[] = ['observe']
  if (score >= 20) actions.push('rate_limit')
  if (score >= 45) actions.push('require_reauthentication')
  if (score >= 60) actions.push('revoke_session')
  if (score >= 70) actions.push('restrict_sensitive_actions')

  const financialSignals = signals.filter((signal) =>
    (signal.category === 'payment' || signal.category === 'order_abuse') && signal.confidence >= 0.7,
  )
  if (score >= 85 && financialSignals.length >= 2) actions.push('freeze_financial_operations')
  if (score >= 75 && signals.length >= 2) actions.push('create_evidence_hold', 'alert_security_admin')

  return {
    score,
    confidence,
    categoryScores: Object.fromEntries(
      CATEGORIES.map((category) => [category, Math.round(categoryScores[category])]),
    ) as Record<RiskCategory, number>,
    actions,
    triggeredRules: [...new Set(signals.map((signal) => signal.code))],
  }
}
