import bcrypt from 'bcryptjs'
import { createSupabaseAdmin } from './supabase/server'
import { formatPrice } from './money'
import { audit } from './audit'

export type WalletUserType = 'VENDOR' | 'RIDER'
export type TrustTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND'

export interface WalletBalance {
  user_id: string
  user_type: WalletUserType
  total_balance: number
  available_balance: number
  held_balance: number
  trust_tier: TrustTier
  wallet_pin_hash: string | null
  bank_account_number: string | null   // AES-256-GCM ciphertext at rest (lib/crypto)
  bank_account_last4: string | null     // plaintext last 4, for display
  bank_code: string | null
  bank_account_name: string | null
  bank_name: string | null
  last_bank_added_at: string | null
  is_frozen: boolean
  frozen_reason: string | null
  frozen_at: string | null
  lifetime_earned: number
  total_withdrawals: number
  pin_attempts: number
  pin_locked_until: string | null
}

export interface WalletTransaction {
  id: string
  user_id: string
  user_type: WalletUserType
  type:
    | 'CREDIT' | 'DEBIT' | 'HOLD' | 'RELEASE'
    | 'FREEZE' | 'UNFREEZE' | 'WITHDRAWAL'
    | 'WITHDRAWAL_REVERSAL' | 'ADMIN_ADJUSTMENT'
  amount: number
  balance_before: number
  balance_after: number
  available_before: number | null
  available_after: number | null
  held_before: number | null
  held_after: number | null
  reference: string | null
  order_id: string | null
  description: string | null
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED'
  paystack_transfer_code: string | null
  paystack_recipient_code: string | null
  failure_reason: string | null
  initiated_by: string | null
  release_at: string | null
  created_at: string
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000)
}

export function calculateReleaseTime(
  userType: WalletUserType,
  tier: TrustTier,
  deliveredAt: Date
): Date {
  const riderHours: Record<TrustTier, number> = {
    BRONZE: 24,
    SILVER: 12,
    GOLD: 6,
    DIAMOND: 0,
  }
  const vendorHours: Record<TrustTier, number> = {
    BRONZE: 72,
    SILVER: 36,
    GOLD: 18,
    DIAMOND: 0,
  }
  const hours = userType === 'RIDER' ? riderHours[tier] : vendorHours[tier]
  return addHours(deliveredAt, hours)
}

export function calculateTier(totalCompleted: number, avgRating: number): TrustTier {
  if (totalCompleted >= 500 && avgRating >= 4.8) return 'DIAMOND'
  if (totalCompleted >= 200) return 'GOLD'
  if (totalCompleted >= 50) return 'SILVER'
  return 'BRONZE'
}

export async function getTrustTier(userId: string, userType: WalletUserType): Promise<TrustTier> {
  const db = createSupabaseAdmin()
  const table = userType === 'VENDOR' ? 'vendors' : 'riders'
  const countField = userType === 'VENDOR' ? 'total_ratings' : 'total_deliveries'

  const { data } = await db
    .from(table)
    .select(`avg_rating, ${countField}`)
    .eq('id', userId)
    .maybeSingle()

  if (!data) return 'BRONZE'
  const row = data as unknown as Record<string, unknown>
  return calculateTier(Number(row[countField] ?? 0), Number(row.avg_rating ?? 0))
}

// ─── Atomic credit: calls the Postgres RPC for SELECT FOR UPDATE safety ───────

export async function creditWalletHeld(params: {
  userId: string
  userType: WalletUserType
  amount: number
  orderId: string
  description: string
  releaseAt: Date
  reference: string
}): Promise<string> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('credit_wallet_held', {
    p_user_id:    params.userId,
    p_user_type:  params.userType,
    p_amount:     params.amount,
    p_order_id:   params.orderId,
    p_description: params.description,
    p_release_at: params.releaseAt.toISOString(),
    p_reference:  params.reference,
  })

  if (error) throw new Error(`credit_wallet_held failed: ${error.message}`)
  return data as string
}

// ─── Atomic debit: calls the Postgres RPC ─────────────────────────────────────

export async function debitWalletWithdrawal(params: {
  userId: string
  userType: WalletUserType
  amount: number
  reference: string
  description: string
  dailyLimit: number
  dailyStart: string   // ISO; start of the current local day
  weeklyLimit: number
  weeklyStart: string  // ISO; start of the current local week
}): Promise<{ txId: string; success: boolean; errorMsg: string | null }> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('debit_wallet_withdrawal', {
    p_user_id:    params.userId,
    p_user_type:  params.userType,
    p_amount:     params.amount,
    p_reference:  params.reference,
    p_description: params.description,
    p_daily_limit:  params.dailyLimit,
    p_daily_start:  params.dailyStart,
    p_weekly_limit: params.weeklyLimit,
    p_weekly_start: params.weeklyStart,
  })

  if (error) throw new Error(`debit_wallet_withdrawal failed: ${error.message}`)
  const row = (data as unknown as Array<{ tx_id: string; success: boolean; error_msg: string | null }>)[0]
  return { txId: row.tx_id, success: row.success, errorMsg: row.error_msg }
}

// ─── Atomic reversal ───────────────────────────────────────────────────────────

export async function reverseWithdrawal(txId: string, reason: string): Promise<boolean> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('reverse_withdrawal', {
    p_tx_id:          txId,
    p_failure_reason: reason,
  })
  if (error) {
    console.error('[reverseWithdrawal] RPC error:', error.message)
    return false
  }
  return !!data
}

// ─── Freeze / Unfreeze ─────────────────────────────────────────────────────────

export async function freezeWallet(params: {
  userId: string
  userType: WalletUserType
  reason: string
  adminPhone: string
}): Promise<void> {
  const db = createSupabaseAdmin()

  await db
    .from('wallet_balances')
    .update({
      is_frozen:     true,
      frozen_reason: params.reason,
      frozen_at:     new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    })
    .eq('user_id', params.userId)
    .eq('user_type', params.userType)

  await db.from('wallet_transactions').insert({
    user_id:       params.userId,
    user_type:     params.userType,
    type:          'FREEZE',
    amount:        0,
    balance_before: 0,
    balance_after:  0,
    description:   `Wallet frozen by admin: ${params.reason}`,
    status:        'COMPLETED',
    initiated_by:  params.adminPhone,
  })

  await audit({
    actor_id:     params.adminPhone,
    actor_role:   'admin',
    action:       'WALLET_FROZEN',
    target_table: 'wallet_balances',
    target_id:    params.userId,
    new_value:    { reason: params.reason, user_type: params.userType },
  })
}

export async function unfreezeWallet(params: {
  userId: string
  userType: WalletUserType
  reason: string
  adminPhone: string
}): Promise<void> {
  const db = createSupabaseAdmin()

  await db
    .from('wallet_balances')
    .update({
      is_frozen:     false,
      frozen_reason: null,
      frozen_at:     null,
      updated_at:    new Date().toISOString(),
    })
    .eq('user_id', params.userId)
    .eq('user_type', params.userType)

  await db.from('wallet_transactions').insert({
    user_id:       params.userId,
    user_type:     params.userType,
    type:          'UNFREEZE',
    amount:        0,
    balance_before: 0,
    balance_after:  0,
    description:   `Wallet unfrozen by admin: ${params.reason}`,
    status:        'COMPLETED',
    initiated_by:  params.adminPhone,
  })

  await audit({
    actor_id:     params.adminPhone,
    actor_role:   'admin',
    action:       'WALLET_UNFROZEN',
    target_table: 'wallet_balances',
    target_id:    params.userId,
    new_value:    { reason: params.reason, user_type: params.userType },
  })
}

// ─── Wallet PIN helpers ────────────────────────────────────────────────────────

const WEAK_WALLET_PINS = new Set([
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '1234','4321','9876','1212','0123',
])

export function validateWalletPin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits')
  if (WEAK_WALLET_PINS.has(pin)) throw new Error('Choose a stronger PIN')
}

export async function hashWalletPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 12)
}

export async function verifyWalletPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

// ─── Tier display helpers ──────────────────────────────────────────────────────

const TIER_EMOJI: Record<TrustTier, string> = {
  BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', DIAMOND: '💎',
}

const TIER_HOLD: Record<TrustTier, string> = {
  BRONZE: 'Standard hold',
  SILVER: '50% faster releases',
  GOLD:   '75% faster releases',
  DIAMOND: 'Instant release',
}

const NEXT_TIER: Partial<Record<TrustTier, TrustTier>> = {
  BRONZE: 'SILVER', SILVER: 'GOLD', GOLD: 'DIAMOND',
}

const TIER_THRESHOLD: Record<TrustTier, number> = {
  BRONZE: 50, SILVER: 200, GOLD: 500, DIAMOND: 0,
}

export function tierEmoji(tier: TrustTier) { return TIER_EMOJI[tier] }
export function tierHoldLabel(tier: TrustTier) { return TIER_HOLD[tier] }
export function getNextTier(tier: TrustTier): TrustTier | null { return NEXT_TIER[tier] ?? null }

export function ordersToNextTier(count: number, tier: TrustTier): number | null {
  const next = NEXT_TIER[tier]
  if (!next) return null
  return Math.max(0, TIER_THRESHOLD[tier] - count)
}

// ─── Transaction display ───────────────────────────────────────────────────────

export function humanizeTx(
  tx: Pick<WalletTransaction, 'type' | 'description' | 'release_at'>,
  bankLast4?: string
): string {
  switch (tx.type) {
    case 'CREDIT':   return tx.description ?? 'Payment received'
    case 'HOLD': {
      if (!tx.release_at) return 'Earnings held'
      const d = new Date(tx.release_at)
      const label = d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
      const time = d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })
      return `Earnings held — releases ${label} ${time}`
    }
    case 'RELEASE':            return tx.description ?? 'Earnings released'
    case 'WITHDRAWAL':         return bankLast4 ? `Withdrawal to ****${bankLast4}` : 'Withdrawal'
    case 'WITHDRAWAL_REVERSAL': return 'Withdrawal reversed — balance restored'
    case 'FREEZE':             return 'Wallet frozen — contact support'
    case 'UNFREEZE':           return 'Wallet unfrozen'
    case 'ADMIN_ADJUSTMENT':   return tx.description ?? 'Admin adjustment'
    default:                   return tx.description ?? String(tx.type)
  }
}

export function txSign(type: WalletTransaction['type']): '+' | '-' | '' {
  if (['CREDIT','RELEASE','WITHDRAWAL_REVERSAL','UNFREEZE'].includes(type)) return '+'
  if (['WITHDRAWAL','DEBIT','FREEZE'].includes(type)) return '-'
  return ''
}

export function txIcon(type: WalletTransaction['type']): string {
  if (['CREDIT','RELEASE','WITHDRAWAL_REVERSAL'].includes(type)) return '↑'
  if (['WITHDRAWAL','DEBIT'].includes(type)) return '↑'
  if (type === 'HOLD') return '🔒'
  if (['FREEZE','UNFREEZE'].includes(type)) return '🔒'
  return '·'
}

export { formatPrice }
