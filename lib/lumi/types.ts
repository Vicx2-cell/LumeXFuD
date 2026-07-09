import { z } from 'zod'

export const LUMI_MAX_MESSAGE_LENGTH = 280
export const LUMI_STATE_TTL_SECONDS = 60 * 10

export const lumiIntentNames = [
  'check_balance',
  'browse_vendors',
  'view_menu',
  'place_order',
  'order_status',
  'fund_wallet',
  'withdraw',
  'cancel_order',
  'help',
  'fallback',
] as const

export type LumiIntentName = (typeof lumiIntentNames)[number]

export interface LumiEntities {
  vendorId?: string
  vendorName?: string
  itemId?: string
  itemName?: string
  quantity?: number
  amount?: number
  orderId?: string
}

export interface LumiIntentResult {
  intent: LumiIntentName
  confidence: 'exact' | 'strong' | 'weak' | 'fallback'
  entities: LumiEntities
  normalizedMessage: string
}

export const lumiConversationSteps = [
  'idle',
  'awaiting_vendor_selection',
  'awaiting_menu_item',
  'awaiting_quantity',
  'awaiting_order_confirmation',
  'awaiting_payment_confirmation',
  'awaiting_funding_amount',
  'awaiting_withdrawal_amount',
  'awaiting_order_selection',
  'awaiting_cancellation_confirmation',
] as const

export type LumiConversationStep = (typeof lumiConversationSteps)[number]

export interface LumiOrderDraftItem {
  menuItemId: string
  name: string
  quantity: number
  unitPrice: number
}

export interface LumiOrderDraft {
  vendorId?: string
  vendorName?: string
  items: LumiOrderDraftItem[]
}

export interface LumiConversationState {
  version: 1
  step: LumiConversationStep
  activeIntent?: LumiIntentName
  orderDraft?: LumiOrderDraft
  pendingAmount?: number
  pendingOrderId?: string
  updatedAt: string
}

export interface LumiQuickReply {
  id: string
  label: string
  value: string
}

export interface LumiResponse {
  reply: string
  quickReplies?: LumiQuickReply[]
  data?: {
    vendors?: Array<{
      id: string
      name: string
    }>
    menuItems?: Array<{
      id: string
      name: string
      price: number
      available: boolean
    }>
    order?: {
      id: string
      status: string
      total: number
    }
    paymentUrl?: string
  }
}

export interface LumiActionResult {
  response: LumiResponse
  nextState?: LumiConversationState
  clearState?: boolean
}

export const lumiOrderDraftItemSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string().min(1).max(120),
  quantity: z.number().int().positive().max(20),
  unitPrice: z.number().int().nonnegative(),
})

export const lumiOrderDraftSchema = z.object({
  vendorId: z.string().uuid().optional(),
  vendorName: z.string().min(1).max(120).optional(),
  items: z.array(lumiOrderDraftItemSchema).max(20),
})

export const lumiConversationStateSchema = z.object({
  version: z.literal(1),
  step: z.enum(lumiConversationSteps),
  activeIntent: z.enum(lumiIntentNames).optional(),
  orderDraft: lumiOrderDraftSchema.optional(),
  pendingAmount: z.number().int().positive().optional(),
  pendingOrderId: z.string().uuid().optional(),
  updatedAt: z.string().datetime({ offset: true }),
})

export type LumiConversationStateInput = z.input<typeof lumiConversationStateSchema>

export interface LumiConfirmationPayload {
  action: 'place_order' | 'fund_wallet' | 'cancel_order'
  requestBody?: Record<string, unknown>
  orderId?: string
}
