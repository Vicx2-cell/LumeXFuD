import { z } from 'zod'

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const sendOtpInput = z.object({
  phone: z.string().min(7).max(20),
})

export const verifyOtpInput = z.object({
  phone: z.string().min(7).max(20),
  otp: z.string().length(6).regex(/^\d{6}$/),
})

// ─── Orders ───────────────────────────────────────────────────────────────────

export const createOrderInput = z.object({
  vendor_id: z.string().uuid(),
  items: z.array(
    z.object({
      menu_item_id: z.string().uuid(),
      quantity: z.number().int().positive().max(20),
      special_instructions: z.string().max(200).optional(),
      addons: z.array(z.string().uuid()).max(20).optional().default([]),
    })
  ).min(1).max(50),
  delivery_type: z.enum(['BIKE', 'DOOR']),
  delivery_address: z.string().min(5).max(500),
  delivery_instructions: z.string().max(300).optional(),
  tip_amount: z.number().int().min(0).max(50000).optional().default(0),
  // How the customer intends to pay. The wallet split is ALWAYS recomputed
  // server-side from the live balance — any client-sent wallet amount is
  // ignored (rule #4/#19). PAYSTACK is the safe default.
  payment_method: z.enum(['PAYSTACK', 'WALLET', 'SPLIT']).optional().default('PAYSTACK'),
  // Optional: schedule the meal for a future DELIVERY time (ISO 8601). Omitted /
  // null = order now. Bounds (lead time, opening hours, max days ahead) are
  // enforced server-side in the orders route — this only checks it's a date.
  scheduled_for: z.string().datetime({ offset: true }).nullable().optional(),
  // Optional GPS for the delivery (student grants browser permission). Stored
  // non-fatally after the order is created; used for rider nav + location data.
  delivery_latitude:  z.number().min(-90).max(90).nullable().optional(),
  delivery_longitude: z.number().min(-180).max(180).nullable().optional(),
})

export const orderStatusInput = z.object({
  status: z.enum([
    'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED',
    'PICKED_UP', 'DELIVERED', 'COMPLETED', 'CANCELLED',
  ]),
})

export const disputeInput = z.object({
  reason: z.string().min(10).max(500),
  description: z.string().max(2000).optional(),
})

// Customer rates the vendor 1–5 stars after an order (the vendor review is
// public), and may optionally also rate the rider (private to the rider/admin).
// Reviews are trimmed and length-capped; empty text is treated as "no review".
export const ratingInput = z.object({
  stars: z.number().int().min(1).max(5),
  review: z.string().trim().max(500).optional(),
  rider_stars: z.number().int().min(1).max(5).optional(),
  rider_review: z.string().trim().max(500).optional(),
})

export const orderMessageInput = z.object({
  message: z.string().min(1).max(500),
})

// ─── Vendors ──────────────────────────────────────────────────────────────────

export const vendorStatusInput = z.object({
  status: z.enum(['OPEN', 'BUSY', 'CLOSED']),
})

export const vendorPauseInput = z.object({
  minutes: z.enum(['15', '30', '60']),
})

// ─── Wallet ───────────────────────────────────────────────────────────────────

export const withdrawInput = z.object({
  amount_naira: z.number().int().min(500).max(25_000),
  wallet_pin:   z.string().length(4).regex(/^\d{4}$/),
})

export const verifyAccountInput = z.object({
  account_number: z.string().length(10).regex(/^\d{10}$/),
  bank_code:      z.string().min(3).max(10).regex(/^\d{3,10}$/),
})

export const saveBankInput = z.object({
  account_number: z.string().length(10).regex(/^\d{10}$/),
  bank_code:      z.string().min(3).max(10).regex(/^\d{3,10}$/),
  bank_name:      z.string().min(2).max(100),
  account_name:   z.string().min(2).max(200),
  wallet_pin:     z.string().length(4).regex(/^\d{4}$/),
})

export const walletSetPinInput = z.object({
  pin:         z.string().length(4).regex(/^\d{4}$/),
  confirm_pin: z.string().length(4).regex(/^\d{4}$/),
  current_pin: z.string().length(4).regex(/^\d{4}$/).optional(),
})

export const walletFreezeInput = z.object({
  user_id:   z.string().uuid(),
  user_type: z.enum(['VENDOR', 'RIDER']),
  reason:    z.string().min(5).max(500),
})

// ─── Admin ────────────────────────────────────────────────────────────────────

export const resolveDisputeInput = z.object({
  resolution: z.enum(['REFUND', 'NO_ACTION']),
  notes: z.string().max(1000).optional(),
})

export const refundInput = z.object({
  order_id: z.string().uuid(),
  reason: z.string().min(5).max(500),
  amount: z.number().int().positive().optional(),
})

// ─── Login PIN ────────────────────────────────────────────────────────────────

export const loginPinInput = z.object({
  phone: z.string().min(7).max(20),
  pin:   z.string().length(6).regex(/^\d{6}$/),
})

export const setPinLoginInput = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/),
})

export const changePinLoginInput = z.object({
  current_pin: z.string().length(6).regex(/^\d{6}$/),
  new_pin:     z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
})

export const removePinLoginInput = z.object({
  current_pin: z.string().length(6).regex(/^\d{6}$/),
})

// ─── Universal PIN auth ────────────────────────────────────────────────────────

const pinField   = z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits')
const phoneField = z.string().min(7).max(20)
const answerField = z.string().min(2).max(200).transform((s) => s.trim().toLowerCase())

export const registerInput = z.object({
  name:         z.string().min(1).max(100).transform((s) => s.trim()),
  phone:        phoneField,
  pin:          pinField,
  confirm_pin:  pinField,
  question_1:   z.string().min(5).max(300),
  answer_1:     answerField,
  question_2:   z.string().min(5).max(300),
  answer_2:     answerField,
})

export const universalLoginInput = z.object({
  phone: phoneField,
  pin:   pinField,
})

export const firstLoginSetupInput = z.object({
  pin:         pinField,
  confirm_pin: pinField,
  question_1:  z.string().min(5).max(300),
  answer_1:    answerField,
  question_2:  z.string().min(5).max(300),
  answer_2:    answerField,
})

export const forgotPinGetQuestionsInput = z.object({
  phone: phoneField,
})

export const forgotPinSecurityAnswersInput = z.object({
  phone:       phoneField,
  answer_1:    answerField,
  answer_2:    answerField,
  new_pin:     pinField,
  confirm_pin: pinField,
})

export const forgotPinRecoveryCodeInput = z.object({
  phone:         phoneField,
  recovery_code: z.string().min(10).max(30),
  new_pin:       pinField,
  confirm_pin:   pinField,
})

export const regenerateRecoveryCodeInput = z.object({
  current_pin: pinField,
})

export const adminResetPinInput = z.object({
  user_id:   z.string().min(1).max(100),
  user_role: z.enum(['customer', 'vendor', 'rider', 'admin']),
})

// ─── Image upload ─────────────────────────────────────────────────────────────

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']

// ─── Vendor menu ────────────────────────────────────────────────────────────────

export const MENU_CATEGORIES = ['RICE', 'PROTEIN', 'DRINKS', 'SNACKS', 'OTHER'] as const

// Add-on prices are entered in naira by the vendor; converted to kobo server-side.
export const menuAddonInput = z.object({
  name:        z.string().min(1).max(60),
  price_naira: z.number().int().min(0).max(100_000),
})

export const createMenuItemInput = z.object({
  name:         z.string().min(1).max(100),
  price_naira:  z.number().int().min(1).max(1_000_000),
  category:     z.enum(MENU_CATEGORIES),
  description:  z.string().max(300).optional(),
  image_url:    z.string().url().max(500).optional(),
  is_available: z.boolean().optional().default(true),
  // Per-dish prep time (minutes). Omit/null = use the vendor's base prep time.
  prep_time_minutes: z.number().int().min(1).max(180).nullable().optional(),
  addons:       z.array(menuAddonInput).max(20).optional().default([]),
})

export const updateMenuItemInput = z.object({
  name:         z.string().min(1).max(100).optional(),
  price_naira:  z.number().int().min(1).max(1_000_000).optional(),
  category:     z.enum(MENU_CATEGORIES).optional(),
  description:  z.string().max(300).nullable().optional(),
  image_url:    z.string().url().max(500).nullable().optional(),
  is_available: z.boolean().optional(),
  prep_time_minutes: z.number().int().min(1).max(180).nullable().optional(),
  // When present, replaces the item's whole add-on list.
  addons:       z.array(menuAddonInput).max(20).optional(),
})
