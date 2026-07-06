export type Intent =
  | 'check_balance'
  | 'browse_vendors'
  | 'view_menu'
  | 'place_order'
  | 'order_status'
  | 'fund_wallet'
  | 'withdraw'
  | 'cancel_order'
  | 'help'
  | 'fallback'

export type Entities = Record<string, string | number | undefined>

type IntentDef = {
  name: Intent
  pattern: RegExp
}

const INTENTS: IntentDef[] = [
  { name: 'check_balance', pattern: /\b(balance|wallet|how much|funds)\b/i },
  { name: 'browse_vendors', pattern: /\b(vendor|vendors|stores|shops|near me|show vendors)\b/i },
  { name: 'view_menu', pattern: /(?:menu|show me|what does)\s*(?:of|from)?\s*([\w\s'&-]+)/i },
  // place_order: allow qty before item, item name, and optional vendor after 'from'
  { name: 'place_order', pattern: /\b(order|i want|i'd like|buy|add)\b[\s:,-]*(?:((?:\d+)\s*x?)\s*)?([\w\s'&-]+?)(?:\s+from\s+([\w\s'&-]+))?$/i },
  { name: 'order_status', pattern: /\b(status|where is my order|track)\b(?:.*?(?:order\s*#?|#)?(\w+))?/i },
  { name: 'fund_wallet', pattern: /\b(top ?up|deposit|add money|fund)\b(?:.*?(\d+(?:\.\d{1,2})?))?/i },
  { name: 'withdraw', pattern: /\b(withdraw|payout|transfer out)\b/i },
  { name: 'cancel_order', pattern: /\b(cancel|cancel my order|i want to cancel)\b(?:.*?(?:order\s*#?|#)?(\w+))?/i },
  { name: 'help', pattern: /\b(help|support|how do i|what can you do)\b/i },
]

export function matchIntent(message: string): { intent: Intent; entities: Entities } {
  if (!message || !message.trim()) return { intent: 'fallback', entities: {} }
  for (const def of INTENTS) {
    const m = message.match(def.pattern)
    if (m) {
      const ents: Entities = {}
      // extract common capture groups by position for a few intents
      switch (def.name) {
        case 'view_menu':
          ents.vendor = m[1]?.trim()
          break
        case 'place_order':
          // pattern captures: optional qty (like '2' or '2x') in m[2], item in m[3], optional vendor in m[4]
          if (m[2]) {
            const q = m[2].match(/(\d+)/)
            if (q) ents.quantity = parseInt(q[1], 10)
          }
          if (m[3]) ents.item = m[3].trim()
          if (m[4]) ents.vendor = m[4].trim()
          break
        case 'order_status':
          if (m[1]) ents.orderNumber = m[1].trim()
          break
        case 'fund_wallet':
          if (m[2]) ents.amount = parseFloat(m[2])
          break
        case 'cancel_order':
          if (m[1]) ents.orderNumber = m[1].trim()
          break
        default:
          break
      }
      return { intent: def.name, entities: ents }
    }
  }
  return { intent: 'fallback', entities: {} }
}
