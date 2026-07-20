export const FAQ_ROLES = ['customers', 'vendors', 'riders'] as const

export type FaqRole = (typeof FAQ_ROLES)[number]

export interface FaqItem {
  id: string
  role: FaqRole
  category: string
  question: string
  answer: string
  keywords: readonly string[]
}

export const FAQ_ROLE_LABELS: Record<FaqRole, string> = {
  customers: 'Customers',
  vendors: 'Vendors',
  riders: 'Riders',
}

// Every answer below is grounded in an implemented LumeX flow. Keep policy
// details linked to their canonical pages instead of duplicating mutable terms.
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'ordering',
    role: 'customers',
    category: 'Ordering',
    question: 'How do I place an order?',
    answer: 'Create or sign in to your account, choose an available vendor, add available items to your cart, then confirm your delivery option and location at checkout. The complete price breakdown is shown before you pay.',
    keywords: ['cart', 'menu', 'checkout', 'food', 'restaurant'],
  },
  {
    id: 'delivery',
    role: 'customers',
    category: 'Delivery',
    question: 'Where can LumeX deliver my order?',
    answer: 'LumeX currently serves supported areas around Abia State University, Uturu. Share your current location at checkout; the app checks the vendor’s delivery range and tells you before payment if that location is unavailable.',
    keywords: ['address', 'location', 'hostel', 'range', 'area', 'door', 'bike'],
  },
  {
    id: 'payments',
    role: 'customers',
    category: 'Payment',
    question: 'How do payments work?',
    answer: 'Payments are digital and processed securely through Paystack, with eligible LumeX Wallet funds applied where available. Food, platform, delivery, and optional tip amounts are itemised at checkout; LumeX does not store your card details.',
    keywords: ['card', 'bank', 'ussd', 'wallet', 'paystack', 'charge', 'fee'],
  },
  {
    id: 'refunds',
    role: 'customers',
    category: 'Refunds',
    question: 'When will I receive a refund?',
    answer: 'Approved wallet refunds are usually available immediately. Card, bank, or USSD refunds are sent back through Paystack and can take a few business days to reflect, depending on your bank. See the Refund & Cancellation Policy for the full rules.',
    keywords: ['money back', 'reversal', 'failed payment', 'bank', 'wallet'],
  },
  {
    id: 'tracking',
    role: 'customers',
    category: 'Tracking',
    question: 'How do I follow my order?',
    answer: 'Open Orders and select the order to see its latest status, from vendor review and preparation through pickup and completion. Keep the order page available while your order is active so you can see updates and any delivery action you need to take.',
    keywords: ['status', 'where is my order', 'preparing', 'ready', 'rider'],
  },
  {
    id: 'delivery-code',
    role: 'customers',
    category: 'Delivery code',
    question: 'What is my delivery code for?',
    answer: 'When code confirmation is enabled for your order, the order page provides a private 6-character code at the appropriate stage. Give it only to your rider when you have the order; it confirms handover. A leave-at-gate delivery does not use a code.',
    keywords: ['handover', 'collection', 'six character', '6 character', 'security', 'pin'],
  },
  {
    id: 'cancellation',
    role: 'customers',
    category: 'Cancellation',
    question: 'Can I cancel an order?',
    answer: 'You can cancel from the order screen before the vendor accepts. Once the vendor has accepted and committed to preparing the food, customer cancellation is no longer available. If a vendor does not accept in time, LumeX cancels and handles any applicable refund automatically.',
    keywords: ['cancel', 'vendor accepted', 'automatic', 'five minutes'],
  },
  {
    id: 'customer-support',
    role: 'customers',
    category: 'Support',
    question: 'How do I get help with an order?',
    answer: 'Use the actions on your order page for an order-specific issue. For anything unresolved, contact LumeX Support with your order number and a clear description of what happened. Payment and refund rules are also available on the public policy page.',
    keywords: ['contact', 'problem', 'complaint', 'email', 'dispute'],
  },
  {
    id: 'vendor-application',
    role: 'vendors',
    category: 'Application',
    question: 'How do I apply to sell on LumeX?',
    answer: 'Open the vendor application, verify your WhatsApp number, and submit your owner, business, registration, location, and operating details. Submitting an application does not make the store live immediately; the LumeX team reviews it first.',
    keywords: ['merchant', 'join', 'register', 'shop', 'whatsapp', 'cac'],
  },
  {
    id: 'vendor-verification',
    role: 'vendors',
    category: 'Verification',
    question: 'What happens during vendor verification?',
    answer: 'The team checks the application details and the required business or site information before approval. If more information is needed, LumeX contacts the verified WhatsApp number supplied in the application.',
    keywords: ['approval', 'review', 'inspection', 'identity', 'documents'],
  },
  {
    id: 'vendor-menu',
    role: 'vendors',
    category: 'Menu management',
    question: 'How do I update my menu?',
    answer: 'Use Menu in the vendor dashboard to add or edit items, prices, descriptions, images, preparation times, and add-ons. You can hide an item immediately or mark it sold out for today so customers cannot order it while unavailable.',
    keywords: ['dish', 'food', 'price', 'addon', 'image', 'sold out', 'availability'],
  },
  {
    id: 'vendor-orders',
    role: 'vendors',
    category: 'Orders',
    question: 'How should I handle a new order?',
    answer: 'Review new orders promptly in the vendor dashboard. Accept only when you can fulfil the order, then keep its status current as preparation progresses. If you cannot fulfil it, reject it before cooking so the customer can be notified and any payment handled correctly.',
    keywords: ['accept', 'reject', 'prepare', 'ready', 'dashboard'],
  },
  {
    id: 'vendor-availability',
    role: 'vendors',
    category: 'Availability',
    question: 'How do I control when customers can order?',
    answer: 'Your store status and business hours control whether customers can place immediate orders. Use the vendor dashboard to keep the store state accurate, and hide individual menu items whenever they are unavailable.',
    keywords: ['open', 'closed', 'busy', 'pause', 'hours', 'online'],
  },
  {
    id: 'vendor-payouts',
    role: 'vendors',
    category: 'Payouts',
    question: 'Where can I see my earnings and payouts?',
    answer: 'Open Earnings in the vendor dashboard to see completed-order earnings, held and available balances, withdrawals, and payout history. A verified bank account and wallet security checks are required before eligible funds can be withdrawn.',
    keywords: ['wallet', 'bank', 'withdraw', 'held balance', 'money'],
  },
  {
    id: 'vendor-support',
    role: 'vendors',
    category: 'Support',
    question: 'How can a vendor contact support?',
    answer: 'Open Support in the vendor dashboard for order, payout, menu, or account help. Include the order number for an order issue and avoid sending card details, PINs, or one-time codes.',
    keywords: ['contact', 'help', 'email', 'order issue', 'account'],
  },
  {
    id: 'rider-application',
    role: 'riders',
    category: 'Application',
    question: 'How do I apply to ride with LumeX?',
    answer: 'Open the rider application, verify your WhatsApp number, and provide the requested contact, delivery method, operating area, identity, guarantor, and vehicle details that apply to you. The team reviews the submission before activation.',
    keywords: ['join', 'register', 'bike', 'bicycle', 'foot', 'nin', 'guarantor'],
  },
  {
    id: 'rider-approval',
    role: 'riders',
    category: 'Approval',
    question: 'Can I start deliveries immediately after applying?',
    answer: 'No. An application must be reviewed and the required identity or vehicle checks completed before a rider account is approved and active. LumeX contacts you using the verified number from your application.',
    keywords: ['review', 'verification', 'active', 'pending', 'identity'],
  },
  {
    id: 'rider-deliveries',
    role: 'riders',
    category: 'Deliveries',
    question: 'How do I accept and complete a delivery?',
    answer: 'Approved active riders can review available jobs in the rider app, including the delivery type, address, vendor, and rider amount. After accepting a job, follow the order steps through pickup and handover, keeping the status accurate throughout.',
    keywords: ['job', 'order', 'accept', 'pickup', 'address', 'complete'],
  },
  {
    id: 'rider-earnings',
    role: 'riders',
    category: 'Earnings',
    question: 'When can I see earnings from a delivery?',
    answer: 'The rider amount is shown on an available job before acceptance. After a delivery is completed, earnings appear in the rider wallet and may remain held for a short review period before becoming available.',
    keywords: ['pay', 'fee', 'wallet', 'held', 'balance', 'money'],
  },
  {
    id: 'rider-delivery-codes',
    role: 'riders',
    category: 'Delivery codes',
    question: 'How do I use a customer’s delivery code?',
    answer: 'When code confirmation is enabled, ask the customer for the private 6-character code only at handover and enter it in the rider app. Never ask for it before arrival. For an authorised leave-at-gate order, follow the separate confirmation flow shown in the app.',
    keywords: ['handover', 'six character', '6 character', 'collection', 'pin', 'gate'],
  },
  {
    id: 'rider-safety',
    role: 'riders',
    category: 'Safety',
    question: 'What should I do if a delivery feels unsafe?',
    answer: 'Do not put yourself at risk. Stop in a safe place and contact LumeX Support with the order number and what is happening. Do not mark an order complete unless the handover or authorised drop-off flow in the app has actually been completed.',
    keywords: ['emergency', 'risk', 'incident', 'problem', 'unsafe'],
  },
  {
    id: 'rider-withdrawals',
    role: 'riders',
    category: 'Withdrawals',
    question: 'How do I withdraw rider earnings?',
    answer: 'Open Wallet to view the available balance and payout history. Add and verify your bank account, set the required wallet PIN, and follow any security wait shown in the app before requesting a withdrawal. Held funds cannot be withdrawn yet.',
    keywords: ['bank', 'payout', 'wallet', 'pin', 'held funds', 'cash out'],
  },
  {
    id: 'rider-support',
    role: 'riders',
    category: 'Support',
    question: 'How can a rider get help?',
    answer: 'Contact LumeX Support for an active delivery, payout, or account problem and include the relevant order number when there is one. Never send your wallet PIN, login PIN, or one-time code to anyone.',
    keywords: ['contact', 'help', 'email', 'account', 'payout issue'],
  },
] as const

export function isFaqRole(value: string): value is FaqRole {
  return FAQ_ROLES.includes(value as FaqRole)
}

export function findFaqByHash(hash: string): FaqItem | undefined {
  const id = decodeURIComponent(hash.replace(/^#/, '')).trim().toLowerCase()
  return FAQ_ITEMS.find((item) => item.id === id)
}

export function filterFaqItems(role: FaqRole, query: string): FaqItem[] {
  const terms = query.toLocaleLowerCase('en-NG').trim().split(/\s+/).filter(Boolean)
  const roleItems = FAQ_ITEMS.filter((item) => item.role === role)
  if (terms.length === 0) return roleItems

  return roleItems.filter((item) => {
    const haystack = [item.question, item.answer, item.category, ...item.keywords]
      .join(' ')
      .toLocaleLowerCase('en-NG')
    return terms.every((term) => haystack.includes(term))
  })
}

export function buildFaqJsonLd(items: readonly FaqItem[]) {
  if (items.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }
}

export function toggleFaqItem(currentId: string | null, selectedId: string): string | null {
  return currentId === selectedId ? null : selectedId
}

export function getKeyboardNavigationIndex(
  currentIndex: number,
  key: string,
  itemCount: number,
  orientation: 'horizontal' | 'vertical',
): number | null {
  if (itemCount <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const backward = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  if (key === forward) return (currentIndex + 1) % itemCount
  if (key === backward) return (currentIndex - 1 + itemCount) % itemCount
  return null
}
