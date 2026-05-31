/**
 * LumeX Fud — Customer Wallet helpers
 * All money stored as BIGINT kobo. Never floats.
 * All balance mutations go through Postgres RPCs (SELECT FOR UPDATE safety).
 */

import { createSupabaseAdmin } from './supabase/server'
import { formatPrice } from './money'
import { sendWhatsAppWithFallback } from './termii/whatsapp'
import { recordPlatformEarning } from './platform-earnings'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerWallet {
  customer_id: string
  balance_kobo: number
  lifetime_topup_kobo: number
  lifetime_spent_kobo: number
  is_frozen: boolean
  frozen_reason: string | null
  updated_at: string
}

export interface CustomerWalletTx {
  id: string
  customer_id: string
  type: 'TOPUP' | 'TOPUP_BONUS' | 'PAYMENT' | 'REFUND' | 'FREEZE' | 'ADMIN_ADJUSTMENT'
  amount_kobo: number
  balance_before_kobo: number
  balance_after_kobo: number
  reference: string | null
  order_id: string | null
  description: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  created_at: string
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getTopupBonusPct(): Promise<number> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('id', 'wallet_topup_bonus_percent')
    .maybeSingle()
  // value is JSONB stored as {"value": 5}
  const row = data as { value: { value?: number } } | null
  return Number(row?.value?.value ?? 5)
}

export async function getTopupLimits(): Promise<{ minKobo: number; maxKobo: number }> {
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('settings')
    .select('id, value')
    .in('id', ['wallet_min_topup_kobo', 'wallet_max_topup_kobo'])

  // value is JSONB stored as {"amount_kobo": N}
  const rows = (data ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>
  const map = Object.fromEntries(rows.map((r) => [r.id, Number(r.value?.amount_kobo ?? 0)]))
  return {
    minKobo: map['wallet_min_topup_kobo'] ?? 50_000,
    maxKobo: map['wallet_max_topup_kobo'] ?? 5_000_000,
  }
}

// ─── Fetch wallet (with auto-create) ─────────────────────────────────────────

export async function getCustomerWallet(customerId: string): Promise<CustomerWallet | null> {
  const db = createSupabaseAdmin()

  // Ensure wallet row exists (trigger handles new customers, but belt-and-suspenders)
  await db
    .from('customer_wallets')
    .upsert({ customer_id: customerId }, { onConflict: 'customer_id', ignoreDuplicates: true })

  const { data } = await db
    .from('customer_wallets')
    .select('customer_id, balance_kobo, lifetime_topup_kobo, lifetime_spent_kobo, is_frozen, frozen_reason, updated_at')
    .eq('customer_id', customerId)
    .maybeSingle()

  return (data as CustomerWallet | null)
}

// ─── Topup (called from Paystack webhook) ─────────────────────────────────────

export async function processCustomerTopup(params: {
  customerId: string
  amountKobo: number
  reference: string
  customerPhone?: string
  customerName?: string
}): Promise<string> {
  const db = createSupabaseAdmin()

  const bonusPct = await getTopupBonusPct()
  const bonusKobo = Math.floor((params.amountKobo * bonusPct) / 100)
  const totalCredited = params.amountKobo + bonusKobo

  const { data, error } = await db.rpc('topup_customer_wallet', {
    p_customer_id: params.customerId,
    p_amount_kobo: params.amountKobo,
    p_bonus_kobo:  bonusKobo,
    p_reference:   params.reference,
    p_description: `Wallet top-up${bonusPct > 0 ? ` + ${bonusPct}% bonus` : ''}`,
  })

  if (error) throw new Error(`topup_customer_wallet RPC failed: ${error.message}`)

  // Record bonus as platform cost (fire-and-forget, only when a bonus was issued)
  if (bonusKobo > 0) {
    void recordPlatformEarning({
      type:        'TOPUP_BONUS_COST',
      amount_kobo: -bonusKobo,   // negative = cost to the platform
      description: `Wallet top-up bonus ${bonusPct}% — customer ${params.customerId.slice(0, 8)} — ref ${params.reference}`,
    })
  }

  // WhatsApp notification (non-blocking)
  if (params.customerPhone) {
    const name = params.customerName ? ` ${params.customerName.split(' ')[0]},` : ','
    sendWhatsAppWithFallback({
      to: params.customerPhone,
      message: bonusKobo > 0
        ? `Hey${name} ${formatPrice(params.amountKobo)} loaded + ${formatPrice(bonusKobo)} bonus (${bonusPct}% 🎁) added to your LumeX Wallet!\nNew balance: ${formatPrice(totalCredited)}.\nCheckout faster on your next order.`
        : `${formatPrice(params.amountKobo)} loaded to your LumeX Wallet!\nBalance: ${formatPrice(params.amountKobo)}.`,
    }).catch(() => {})
  }

  return data as string
}

// ─── Spend wallet at checkout ─────────────────────────────────────────────────

export async function spendCustomerWallet(params: {
  customerId: string
  amountKobo: number
  orderId: string
  orderNumber: string
  reference: string
}): Promise<{ success: boolean; errorMsg: string | null; newBalance: number }> {
  const db = createSupabaseAdmin()

  const { data, error } = await db.rpc('spend_customer_wallet', {
    p_customer_id: params.customerId,
    p_amount_kobo: params.amountKobo,
    p_order_id:    params.orderId,
    p_reference:   params.reference,
    p_description: `Payment for order #${params.orderNumber}`,
  })

  if (error) throw new Error(`spend_customer_wallet RPC failed: ${error.message}`)

  const row = (data as Array<{ success: boolean; error_msg: string | null; new_balance: number }>)[0]
  return { success: row.success, errorMsg: row.error_msg, newBalance: row.new_balance }
}

// ─── Refund to wallet ─────────────────────────────────────────────────────────

export async function refundToCustomerWallet(params: {
  customerId: string
  amountKobo: number
  orderId: string
  reference: string
  reason: string
  customerPhone?: string
}): Promise<boolean> {
  const db = createSupabaseAdmin()

  const { data, error } = await db.rpc('refund_customer_wallet', {
    p_customer_id: params.customerId,
    p_amount_kobo: params.amountKobo,
    p_order_id:    params.orderId,
    p_reference:   params.reference,
    p_description: `Refund: ${params.reason}`,
  })

  if (error) {
    console.error('[refundToCustomerWallet] RPC error:', error.message)
    return false
  }

  if (params.customerPhone) {
    sendWhatsAppWithFallback({
      to: params.customerPhone,
      message: `${formatPrice(params.amountKobo)} refunded to your LumeX Wallet.\nReason: ${params.reason}\nBalance available for your next order.`,
    }).catch(() => {})
  }

  return !!data
}

// ─── Freeze / Unfreeze customer wallet ────────────────────────────────────────

export async function freezeCustomerWallet(params: {
  customerId: string
  reason: string
  adminPhone: string
}): Promise<void> {
  const db = createSupabaseAdmin()

  await db
    .from('customer_wallets')
    .update({ is_frozen: true, frozen_reason: params.reason, updated_at: new Date().toISOString() })
    .eq('customer_id', params.customerId)

  await db.from('customer_wallet_transactions').insert({
    customer_id:         params.customerId,
    type:                'FREEZE',
    amount_kobo:         0,
    balance_before_kobo: 0,
    balance_after_kobo:  0,
    description:         `Wallet frozen by admin: ${params.reason}`,
    status:              'COMPLETED',
  })
}

export async function unfreezeCustomerWallet(params: {
  customerId: string
  reason: string
}): Promise<void> {
  const db = createSupabaseAdmin()

  await db
    .from('customer_wallets')
    .update({ is_frozen: false, frozen_reason: null, updated_at: new Date().toISOString() })
    .eq('customer_id', params.customerId)
}

// ─── Transaction display helpers ───────────────────────────────────────────────

export function customerTxIcon(type: CustomerWalletTx['type']): string {
  switch (type) {
    case 'TOPUP':           return '↑'
    case 'TOPUP_BONUS':     return '🎁'
    case 'PAYMENT':         return '↓'
    case 'REFUND':          return '↩️'
    case 'FREEZE':          return '🔒'
    case 'ADMIN_ADJUSTMENT': return '⚙️'
    default:                return '·'
  }
}

export function customerTxSign(type: CustomerWalletTx['type']): '+' | '-' | '' {
  switch (type) {
    case 'TOPUP':
    case 'TOPUP_BONUS':
    case 'REFUND':      return '+'
    case 'PAYMENT':
    case 'FREEZE':      return '-'
    default:            return ''
  }
}

export function customerTxColor(type: CustomerWalletTx['type']): string {
  const positive = ['TOPUP', 'TOPUP_BONUS', 'REFUND']
  const negative = ['PAYMENT', 'FREEZE']
  if (positive.includes(type)) return 'text-green-400'
  if (negative.includes(type)) return 'text-red-400'
  return 'text-white/60'
}

export { formatPrice }
