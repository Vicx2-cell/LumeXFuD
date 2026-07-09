import type { LumiEntities, LumiIntentResult, LumiIntentName } from './types'

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const HELP_PATTERNS = [
  /^help$/,
  /^help me$/,
  /\bwhat can you do\b/,
  /\bshow commands\b/,
  /\bhow does lumi work\b/,
]

const CHECK_BALANCE_PATTERNS = [
  /\bwallet balance\b/,
  /\bcheck (?:my )?(?:wallet|balance)\b/,
  /\bwhat is my balance\b/,
  /\bhow much do i have\b/,
  /\bshow (?:my )?wallet\b/,
]

const BROWSE_VENDOR_PATTERNS = [
  /\bshow vendors\b/,
  /\bshow food vendors\b/,
  /\bavailable restaurants\b/,
  /\bwhere can i order\b/,
  /\bwhat restaurants are available\b/,
  /\bbrowse vendors\b/,
]

const VIEW_MENU_PATTERNS = [
  /\bshow\s+(.+?)['’]s\s+menu\b/,
  /\bmenu for\s+(.+)\b/,
  /\bshow\s+menu\s+for\s+(.+)\b/,
  /\bwhat does\s+(.+?)\s+sell\b/,
  /\bview menu\b/,
  /\bshow menu\b/,
]

const PLACE_ORDER_PATTERNS = [
  /\border\b/,
  /\bi want to order\b/,
  /\bi want food\b/,
  /\bi want\b/,
  /\bbuy\b/,
]

const ORDER_STATUS_PATTERNS = [
  /\btrack my order\b/,
  /\bwhere is my food\b/,
  /\bwhat is my order status\b/,
  /\bcheck order\b/,
  /\border status\b/,
]

const FUND_WALLET_PATTERNS = [
  /\bfund (?:my )?wallet\b/,
  /\btop ?up\b/,
  /\bdeposit\b/,
  /\badd\s+(?:₦|naira)?\s*\d[\d,]*/,
]

const WITHDRAW_PATTERNS = [
  /\bwithdraw\b/,
  /\bsend\s+₦?\s*\d[\d,]*\s+from my wallet\b/,
]

const CANCEL_PATTERNS = [
  /\bcancel my order\b/,
  /\bcancel order\b/,
  /\bi don['’]?t want the order anymore\b/,
]

function normalizeMessage(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[’']/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₦/g, ' naira ')
    .replace(/[!?.;:()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseIntegerToken(token: string | undefined): number | undefined {
  if (!token) return undefined
  const clean = token.toLowerCase().trim()
  if (NUMBER_WORDS[clean] !== undefined) return NUMBER_WORDS[clean]
  const digits = clean.replace(/,/g, '')
  if (/^\d+$/.test(digits)) return Number.parseInt(digits, 10)
  return undefined
}

function extractAmount(message: string): number | undefined {
  const explicit = message.match(/\b(?:naira|add|deposit|top up|topup|fund|withdraw|send)\b(?:\s+my wallet(?: with)?)?\s*(?:with\s*)?(?:naira\s*)?(\d[\d,]*)/i)
  const currencyFirst = message.match(/(?:naira|₦)\s*(\d[\d,]*)/i)
  const match = explicit?.[1] ?? currencyFirst?.[1]
  if (!match) return undefined
  const value = Number.parseInt(match.replace(/,/g, ''), 10)
  return Number.isFinite(value) ? value : undefined
}

function extractOrderId(message: string): string | undefined {
  const match = message.match(/\b(?:order\s*)?(?:#\s*)?([a-z]{2,5}-?\d{2,}|[0-9a-f]{8}-[0-9a-f-]{27})\b/i)
  return match?.[1]?.toUpperCase()
}

function extractPlaceOrderEntities(normalizedMessage: string): LumiEntities {
  const entities: LumiEntities = {}
  const vendorMatch = normalizedMessage.match(/\bfrom\s+(.+)$/)
  if (vendorMatch?.[1]) {
    entities.vendorName = vendorMatch[1].trim()
  }

  const quantityFirst = normalizedMessage.match(/\b(?:order|buy|want)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:plates?\s+of\s+|portions?\s+of\s+)?(.+?)(?:\s+from\s+.+)?$/)
  if (quantityFirst?.[1]) {
    entities.quantity = parseIntegerToken(quantityFirst[1])
    entities.itemName = quantityFirst[2]?.trim()
    return entities
  }

  const orderFood = normalizedMessage.match(/\b(?:order|buy)\s+(.+?)(?:\s+from\s+.+)?$/)
  if (orderFood?.[1]) {
    entities.itemName = orderFood[1].trim()
    return entities
  }

  return entities
}

function extractMenuVendor(normalizedMessage: string): string | undefined {
  for (const pattern of VIEW_MENU_PATTERNS) {
    const match = normalizedMessage.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

function hasAnyPattern(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message))
}

type Candidate = {
  intent: LumiIntentName
  confidence: LumiIntentResult['confidence']
  entities: LumiEntities
  priority: number
}

export function matchIntent(message: string): LumiIntentResult {
  const normalizedMessage = normalizeMessage(message)
  if (!normalizedMessage || !/[a-z0-9]/.test(normalizedMessage)) {
    return { intent: 'fallback', confidence: 'fallback', entities: {}, normalizedMessage }
  }

  const candidates: Candidate[] = []

  if (hasAnyPattern(normalizedMessage, HELP_PATTERNS)) {
    candidates.push({ intent: 'help', confidence: 'exact', entities: {}, priority: 100 })
  }

  if (hasAnyPattern(normalizedMessage, CANCEL_PATTERNS) || /\bcancel\b/.test(normalizedMessage)) {
    candidates.push({
      intent: 'cancel_order',
      confidence: extractOrderId(normalizedMessage) ? 'exact' : 'strong',
      entities: { orderId: extractOrderId(normalizedMessage) },
      priority: 95,
    })
  }

  if (hasAnyPattern(normalizedMessage, ORDER_STATUS_PATTERNS) || /\bwhere is my order\b/.test(normalizedMessage)) {
    candidates.push({
      intent: 'order_status',
      confidence: extractOrderId(normalizedMessage) ? 'exact' : 'strong',
      entities: { orderId: extractOrderId(normalizedMessage) },
      priority: 90,
    })
  }

  if (hasAnyPattern(normalizedMessage, CHECK_BALANCE_PATTERNS)) {
    candidates.push({ intent: 'check_balance', confidence: 'exact', entities: {}, priority: 80 })
  }

  if (hasAnyPattern(normalizedMessage, VIEW_MENU_PATTERNS)) {
    const vendorName = extractMenuVendor(normalizedMessage)
    candidates.push({
      intent: 'view_menu',
      confidence: vendorName ? 'exact' : 'strong',
      entities: vendorName ? { vendorName } : {},
      priority: vendorName ? 78 : 72,
    })
  }

  if (hasAnyPattern(normalizedMessage, BROWSE_VENDOR_PATTERNS)) {
    candidates.push({ intent: 'browse_vendors', confidence: 'strong', entities: {}, priority: 70 })
  }

  const amount = extractAmount(normalizedMessage)
  if (hasAnyPattern(normalizedMessage, FUND_WALLET_PATTERNS)) {
    candidates.push({
      intent: 'fund_wallet',
      confidence: amount ? 'exact' : 'strong',
      entities: amount ? { amount } : {},
      priority: 68,
    })
  }

  if (hasAnyPattern(normalizedMessage, WITHDRAW_PATTERNS)) {
    candidates.push({
      intent: 'withdraw',
      confidence: amount ? 'strong' : 'weak',
      entities: amount ? { amount } : {},
      priority: 66,
    })
  }

  if (hasAnyPattern(normalizedMessage, PLACE_ORDER_PATTERNS)) {
    const entities = extractPlaceOrderEntities(normalizedMessage)
    const confidence: LumiIntentResult['confidence'] =
      entities.itemName && entities.quantity ? 'exact'
        : entities.itemName || entities.vendorName ? 'strong'
          : 'weak'
    candidates.push({ intent: 'place_order', confidence, entities, priority: 60 })
  }

  candidates.sort((a, b) => b.priority - a.priority)
  const chosen = candidates[0]

  if (!chosen) {
    return { intent: 'fallback', confidence: 'fallback', entities: {}, normalizedMessage }
  }

  return {
    intent: chosen.intent,
    confidence: chosen.confidence,
    entities: chosen.entities,
    normalizedMessage,
  }
}

export function isFlowExitMessage(message: string): boolean {
  const normalized = normalizeMessage(message)
  return [
    'cancel',
    'stop',
    'never mind',
    'nevermind',
    'go back',
    'abort',
  ].includes(normalized)
}

export function isConfirmationMessage(message: string): boolean {
  const normalized = normalizeMessage(message)
  return ['confirm', 'yes', 'yes continue', 'continue', 'proceed'].includes(normalized)
}

export function parseQuantityMessage(message: string): number | undefined {
  const normalized = normalizeMessage(message)
  return parseIntegerToken(normalized)
}

export function parseSelectionToken(message: string, prefix: 'vendor' | 'menu' | 'order' | 'qty'): string | undefined {
  const normalized = normalizeMessage(message)
  const match = normalized.match(new RegExp(`^${prefix}:([a-z0-9-]+)$`))
  return match?.[1]
}
