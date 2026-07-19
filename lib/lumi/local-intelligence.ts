import type { LumiResponse } from './types'

const SECURITY_PATTERNS = [
  /\b(?:password|passcode|pin|otp|secret|api[ -]?key|access token|refresh token|private key)\b/i,
  /\b(?:hack|exploit|bypass|break into|take over|steal|dump (?:the )?database|sql injection|xss|csrf|rce)\b/i,
  /\b(?:admin|super[ -]?admin)\b.*\b(?:access|login|credential|panel|account)\b/i,
  /\b(?:show|give|reveal|print|leak|send)\b.*\b(?:environment|env|database|customer data|user data|credentials?)\b/i,
]

const SAFE_SECURITY_PATTERNS = [
  /\bhow (?:do|can|should) i (?:secure|protect)\b/i,
  /\bsecurity (?:tips|advice|best practices)\b/i,
  /\bis (?:my|this|the) account safe\b/i,
]

function response(reply: string): LumiResponse {
  return { reply }
}

export function securityResponse(message: string): LumiResponse | null {
  if (SAFE_SECURITY_PATTERNS.some((pattern) => pattern.test(message))) {
    return response('Use a unique PIN, never share OTPs or passwords, and sign out of devices you do not control. LumeX staff should never ask you for those secrets.')
  }
  if (!SECURITY_PATTERNS.some((pattern) => pattern.test(message))) return null
  return response('I cannot reveal credentials, private user data, internal configuration, or help bypass security. I can help you protect your account or direct you to the proper support flow.')
}

export function isSecuritySensitiveMessage(message: string): boolean {
  return SECURITY_PATTERNS.some((pattern) => pattern.test(message))
}

type Token = { kind: 'number'; value: number } | { kind: 'operator'; value: string }

function tokenize(expression: string): Token[] | null {
  const compact = expression.replace(/\s+/g, '')
  if (!compact || compact.length > 80 || !/^[0-9.+\-*/%()]+$/.test(compact)) return null
  const tokens: Token[] = []
  let index = 0
  while (index < compact.length) {
    const rest = compact.slice(index)
    const number = rest.match(/^\d+(?:\.\d+)?/)
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) })
      index += number[0].length
      continue
    }
    tokens.push({ kind: 'operator', value: compact[index] })
    index += 1
  }
  return tokens
}

function calculate(expression: string): number | null {
  const tokens = tokenize(expression)
  if (!tokens) return null
  let cursor = 0

  const primary = (): number => {
    const token = tokens[cursor]
    if (token?.kind === 'operator' && token.value === '-') {
      cursor += 1
      return -primary()
    }
    if (token?.kind === 'operator' && token.value === '(') {
      cursor += 1
      const value = addSubtract()
      if (tokens[cursor]?.kind !== 'operator' || tokens[cursor]?.value !== ')') throw new Error('parenthesis')
      cursor += 1
      return value
    }
    if (token?.kind !== 'number') throw new Error('number')
    cursor += 1
    return token.value
  }

  const multiplyDivide = (): number => {
    let value = primary()
    while (true) {
      const token = tokens[cursor]
      if (token?.kind !== 'operator' || !['*', '/', '%'].includes(token.value)) break
      const operator = token.value
      cursor += 1
      const right = primary()
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('zero')
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right
    }
    return value
  }

  const addSubtract = (): number => {
    let value = multiplyDivide()
    while (true) {
      const token = tokens[cursor]
      if (token?.kind !== 'operator' || !['+', '-'].includes(token.value)) break
      const operator = token.value
      cursor += 1
      const right = multiplyDivide()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  try {
    const value = addSubtract()
    if (cursor !== tokens.length || !Number.isFinite(value) || Math.abs(value) > 1e15) return null
    return value
  } catch {
    return null
  }
}

function mathResponse(message: string): LumiResponse | null {
  const candidate = message
    .toLowerCase()
    .replace(/^(?:please\s+)?(?:calculate|solve|what(?:'s| is)|work out)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
  if (!/[+\-*/%]/.test(candidate)) return null
  const result = calculate(candidate)
  if (result === null) return null
  return response(`${candidate} = ${Number.isInteger(result) ? result : Number(result.toFixed(6))}`)
}

const KNOWLEDGE: Array<{ pattern: RegExp; answer: string }> = [
  { pattern: /\b(?:hello|hi|hey|good morning|good afternoon|good evening)\b/i, answer: 'Hey! I’m Lumi. What can I help you with today?' },
  { pattern: /\bhow are you\b/i, answer: 'I’m ready and running well. How are you doing?' },
  { pattern: /\b(?:thank you|thanks|thank u)\b/i, answer: 'You’re welcome. I’m here whenever you need me.' },
  { pattern: /\b(?:who|what) are you\b|\bwhat is your name\b/i, answer: 'I’m Lumi, LumeX Fud’s built-in assistant. I run on local rules and live LumeX data—not an external AI service.' },
  { pattern: /\bwhat is lumex(?: fud)?\b/i, answer: 'LumeX Fud is a food ordering and delivery platform built around customers, verified vendors and riders.' },
  { pattern: /\b(?:where|which areas?) (?:does|do|can) (?:lumex|you) deliver\b|\bdelivery coverage\b/i, answer: 'LumeX serves configured delivery zones around ABSU and nearby student lodges. Your home screen shows only vendors in your active zone.' },
  { pattern: /\b(?:opening|working|delivery) hours\b|\bwhat time (?:do you|does lumex) (?:open|close)\b/i, answer: 'LumeX ordering hours are 7:00am to 10:00pm, Africa/Lagos time. A vendor may have shorter opening hours.' },
  { pattern: /\b(?:how (?:do|can) i pay|payment methods?|cash on delivery)\b/i, answer: 'In the LumeX app, customers pay digitally through Paystack or the LumeX Wallet. Never share your PIN, OTP, full card number or bank password in chat.' },
  { pattern: /\b(?:refund|dispute) (?:policy|window|rules?)\b|\bhow (?:do|can) i report (?:an )?order problem\b/i, answer: 'You can raise an order dispute within 24 hours of delivery. An admin reviews the evidence before any refund decision.' },
  { pattern: /\bhow (?:do|can) i become (?:a )?(?:vendor|rider)\b/i, answer: 'Vendor and rider accounts use an application and verification process. Open the relevant application page or contact LumeX support for onboarding.' },
  { pattern: /\b(?:support email|contact support|how (?:do|can) i contact lumex)\b/i, answer: 'You can contact LumeX support at hello@lumexfud.com.ng.' },
  { pattern: /\bcapital of nigeria\b/i, answer: 'The capital of Nigeria is Abuja.' },
  { pattern: /\bcapital of abia(?: state)?\b/i, answer: 'The capital of Abia State is Umuahia.' },
  { pattern: /\bwhat is photosynthesis\b/i, answer: 'Photosynthesis is the process plants use to turn light, water and carbon dioxide into stored chemical energy, releasing oxygen.' },
  { pattern: /\bwhat is gravity\b/i, answer: 'Gravity is the attraction between objects with mass. On Earth, it pulls objects toward the ground.' },
  { pattern: /\bwho (?:wrote|is the author of) things fall apart\b/i, answer: 'Chinua Achebe wrote Things Fall Apart.' },
  { pattern: /\bhow many states (?:are there )?in nigeria\b/i, answer: 'Nigeria has 36 states and the Federal Capital Territory.' },
  { pattern: /\b(?:tell me a joke|make me laugh)\b/i, answer: 'Why did the student bring a ladder to class? They heard the course was on another level.' },
  { pattern: /\b(?:motivate me|i need motivation|encourage me)\b/i, answer: 'Take the next small step, not the whole staircase at once. A focused twenty minutes now is real progress.' },
  { pattern: /\b(?:i am|i'm) (?:bored|tired)\b/i, answer: 'A short reset might help—drink some water, stretch, then choose one small thing to finish. I can also help you find food when you’re ready.' },
]

export function localGeneralResponse(message: string, now = new Date()): LumiResponse | null {
  const secured = securityResponse(message)
  if (secured) return secured

  const math = mathResponse(message)
  if (math) return math

  if (/\b(?:what(?:'s| is) the )?(?:time|current time)\b/i.test(message)) {
    return response(`It is ${new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' }).format(now)} in Nigeria.`)
  }
  if (/\b(?:what(?:'s| is) the )?(?:date|today'?s date|day today)\b/i.test(message)) {
    return response(`Today is ${new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}.`)
  }

  const known = KNOWLEDGE.find((entry) => entry.pattern.test(message))
  if (known) return response(known.answer)

  if (/\?$/.test(message.trim()) || /^(?:who|what|when|where|why|how|which)\b/i.test(message.trim())) {
    return response('I don’t know that reliably from my offline knowledge yet, so I won’t make up an answer. I’m strongest at LumeX orders, vendors, menus, wallet help, calculations and basic everyday questions.')
  }
  return null
}
