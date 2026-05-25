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
    })
  ).min(1).max(50),
  delivery_type: z.enum(['BIKE', 'DOOR']),
  delivery_address: z.string().min(5).max(500),
  delivery_instructions: z.string().max(300).optional(),
  tip_amount: z.number().int().min(0).max(50000).optional().default(0),
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

export const ratingInput = z.object({
  vendor_rating: z.number().int().min(1).max(5),
  vendor_review: z.string().max(500).optional(),
  rider_rating: z.number().int().min(1).max(5),
  rider_review: z.string().max(500).optional(),
  would_order_again: z.boolean().optional(),
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
  amount: z.number().int().min(50000).max(2500000), // ₦500 - ₦25,000 in kobo
  bank_code: z.string().min(3).max(10),
  account_number: z.string().length(10).regex(/^\d{10}$/),
  otp: z.string().length(6).regex(/^\d{6}$/),
  pin: z.string().length(4).regex(/^\d{4}$/),
})

export const verifyAccountInput = z.object({
  account_number: z.string().length(10).regex(/^\d{10}$/),
  bank_code: z.string().min(3).max(10),
})

export const setPinInput = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/),
  current_pin: z.string().length(4).regex(/^\d{4}$/).optional(),
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

// ─── Image upload ─────────────────────────────────────────────────────────────

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
