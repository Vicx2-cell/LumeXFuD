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
  // PICKUP = order ahead / skip the queue (no rider, ₦0 delivery). For PICKUP the
  // delivery_address is optional (the route synthesizes "Pickup at <shop>"); for
  // BIKE/DOOR the route still requires a real address.
  delivery_type: z.enum(['BIKE', 'DOOR', 'PICKUP']),
  delivery_address: z.string().min(5).max(500).optional(),
  // Structured parts behind delivery_address (lodge → block → room). Stored
  // non-fatally after insert so an order never fails if migration 080 is pending;
  // the rider reads them back as scannable chips.
  delivery_lodge: z.string().max(160).optional(),
  delivery_block: z.string().max(80).optional(),
  delivery_room:  z.string().max(80).optional(),
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
  // Optional: the group order this checkout finalizes. Server verifies the caller
  // is that group's host before linking; participants are notified once paid.
  group_order_id: z.string().uuid().nullable().optional(),
  // Binding consent (Invariant I8). For PICKUP this is the explicit tick of the
  // 1h25m agreement and is REQUIRED server-side; for delivery it records the
  // place-order agreement. Recorded append-only against the current terms version.
  pickup_agreement: z.boolean().optional(),
  // Customer opts to waive the door code for a DELIVERY order (leave-at-gate).
  leave_at_gate: z.boolean().optional(),
  // Apply the customer's best eligible reward credit as a discount on this order.
  // Defaults to true (auto-apply) — the server still validates eligibility and
  // computes the discount; a client-sent amount is never trusted.
  apply_reward: z.boolean().optional().default(true),
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

// A fulfiller (vendor at pickup, rider at the door) enters the customer's 6-char
// handover code. Entering the correct code is the ONLY trigger that releases the
// held funds (Invariants I2/I3). Crockford-Base32 alphabet, case-insensitive;
// the engine normalizes + rejects anything outside the safe alphabet.
export const handoverCodeInput = z.object({
  code: z.string().trim().min(6).max(12).regex(/^[0-9A-Za-z-]+$/, 'Enter the 6-character code'),
})
// Back-compat alias for the existing pickup collect route import.
export const pickupCollectInput = handoverCodeInput

// ─── Vendors ──────────────────────────────────────────────────────────────────

export const vendorStatusInput = z.object({
  status: z.enum(['OPEN', 'BUSY', 'CLOSED']),
})

export const vendorPauseInput = z.object({
  minutes: z.enum(['15', '30', '60']),
})

// Vendor pickup (order ahead) settings: opt out of pickup, and a pacing cap on
// simultaneous pickup orders (0 = no cap). Both optional — only sent keys change.
export const vendorPickupSettingsInput = z.object({
  pickup_enabled:        z.boolean().optional(),
  pickup_max_concurrent: z.number().int().min(0).max(100).optional(),
}).refine((v) => v.pickup_enabled !== undefined || v.pickup_max_concurrent !== undefined, {
  message: 'Nothing to update',
})

// Opening / closing time for a vendor or rider. "HH:MM" 24-hour (Africa/Lagos),
// or null to clear. Shared by /api/vendors/[id]/hours and /api/riders/[id]/hours.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24-hour time')
export const businessHoursInput = z.object({
  opening_time: hhmm.nullable(),
  closing_time: hhmm.nullable(),
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
  phone:        phoneField,                  // the WhatsApp / account number
  call_phone:   phoneField.optional(),       // optional separate call number
  pin:          pinField,
  confirm_pin:  pinField,
  question_1:   z.string().min(5).max(300),
  answer_1:     answerField,
  question_2:   z.string().min(5).max(300),
  answer_2:     answerField,
  // Optional referral code (from a /register?ref=CODE link). Validated + attached
  // server-side; a bad/own code is silently ignored, never fails the sign-up.
  referral_code: z.string().trim().min(4).max(12).optional(),
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

// ─── Saved places ─────────────────────────────────────────────────────────────
// Shape validation only; trimming + cross-field rules (half-pin, ranges) live in
// lib/saved-places.ts (cleanPlaceFields) so they're unit-testable and shared.

const placeCoordsShape = {
  latitude:  z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  // Storage key returned by the photo upload route — never a client-chosen URL.
  photo_path: z.string().max(300).nullable().optional(),
}

export const createSavedPlaceInput = z.object({
  label:    z.string().min(1).max(60),
  landmark: z.string().max(120).nullable().optional(),
  is_default: z.boolean().optional(),
  ...placeCoordsShape,
}).strict()

// Update is a partial — any subset of fields may change. Coords stay all-or-
// nothing (enforced in cleanPlaceFields when latitude/longitude are present).
export const updateSavedPlaceInput = z.object({
  label:    z.string().min(1).max(60).optional(),
  landmark: z.string().max(120).nullable().optional(),
  is_default: z.boolean().optional(),
  ...placeCoordsShape,
}).strict()

// ─── Vendor store location (address + map pinpoint) ──────────────────────────
// Shape validation only; trimming + cross-field rules (half-pin, ranges) live in
// lib/vendor-location.ts (cleanVendorLocation) so they're shared + testable.
export const vendorLocationInput = z.object({
  address_text: z.string().max(160).nullable().optional(),
  landmark:     z.string().max(120).nullable().optional(),
  latitude:     z.number().min(-90).max(90).nullable().optional(),
  longitude:    z.number().min(-180).max(180).nullable().optional(),
}).strict()

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
  // One-tap "sold out for today": hide the dish now, auto-restore next day. The
  // restore time is computed server-side (never trust the client clock).
  sold_out_today: z.boolean().optional(),
  prep_time_minutes: z.number().int().min(1).max(180).nullable().optional(),
  // When present, replaces the item's whole add-on list.
  addons:       z.array(menuAddonInput).max(20).optional(),
})
