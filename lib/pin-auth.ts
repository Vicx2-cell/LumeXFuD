import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { createSupabaseAdmin } from './supabase/server'
import { normalizePhone, safeNormalizePhone } from './phone'
import { SessionRole } from './session'

const WEAK_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999',
  '123456', '654321', '012345', '234567', '121212', '123123',
  '112233', '102030', '246810', '135791',
])

const RECOVERY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const DUMMY_HASH = bcrypt.hashSync('lxmx-dummy-secret', 12)

// Explicit auth columns only — never SELECT * here (rule 14), which on
// vendors/riders would also pull bank_account_number (rules 15/16).
export const AUTH_USER_COLUMNS =
  'id, phone, login_pin_hash, pin_attempts, pin_locked_until, pin_reset_pending, ' +
  'security_question_1, security_question_2, security_answer_1_hash, security_answer_2_hash, ' +
  'recovery_code_hash, recovery_attempts, recovery_locked_until'

// Row shape returned by the AUTH_USER_COLUMNS select. (A non-literal select
// string can't be inferred by the Supabase client, so we type it explicitly.)
export interface AuthUserRow {
  id: string
  phone: string
  login_pin_hash: string | null
  pin_attempts: number | null
  pin_locked_until: string | null
  pin_reset_pending: boolean | null
  security_question_1: string | null
  security_question_2: string | null
  security_answer_1_hash: string | null
  security_answer_2_hash: string | null
  recovery_code_hash: string | null
  recovery_attempts: number | null
  recovery_locked_until: string | null
}

// Re-exported from a client-safe module so client components can import the
// constant without dragging in this server-only module (see lib/security-questions.ts).
export { SECURITY_QUESTIONS } from './security-questions'

export function validatePin(pin: string) {
  if (!/^[0-9]{6}$/.test(pin)) {
    throw new Error('PIN must be exactly 6 digits')
  }
  if (WEAK_PINS.has(pin)) {
    throw new Error('Choose a stronger 6-digit PIN')
  }
  const digits = pin.split('').map((d) => Number(d))
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1)
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1)
  if (ascending || descending) {
    throw new Error('PIN cannot be sequential')
  }
}

export function normalizeRecoveryCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatRecoveryCode(raw: string) {
  const normalized = normalizeRecoveryCode(raw)
  const groups = normalized.match(/.{1,4}/g)
  return groups ? groups.join('-') : normalized
}

export function validateRecoveryCode(raw: string) {
  const code = normalizeRecoveryCode(raw)
  if (!/^LXMX[A-Z2-9]{12}$/.test(code)) {
    throw new Error('Invalid recovery code format')
  }
  return formatRecoveryCode(code)
}

export function generateRecoveryCode() {
  const parts = ['LXMX']
  for (let part = 0; part < 3; part += 1) {
    let chunk = ''
    for (let i = 0; i < 4; i += 1) {
      chunk += RECOVERY_CHARS.charAt(crypto.randomInt(0, RECOVERY_CHARS.length))
    }
    parts.push(chunk)
  }
  return parts.join('-')
}

export function generateTempPin(): string {
  let pin: string
  do {
    pin = String(crypto.randomInt(100000, 1000000)).padStart(6, '0')
  } while (WEAK_PINS.has(pin))
  return pin
}

export async function hashSecret(value: string) {
  return bcrypt.hash(value, 12)
}

export async function compareSecret(value: string, hash: string | null) {
  if (!hash) {
    return await bcrypt.compare(value, DUMMY_HASH)
  }
  return await bcrypt.compare(value, hash)
}

export function normalizeSecurityAnswer(answer: string) {
  return answer.trim().toLowerCase()
}

export function getRoleRedirect(role: SessionRole): string {
  switch (role) {
    case 'customer':    return '/home'
    case 'vendor':      return '/vendor-dashboard'
    case 'rider':       return '/rider'
    case 'admin':       return '/admin'
    case 'super_admin': return '/super-admin'
    default:            return '/home'
  }
}

export async function findAuthUserByPhone(phone: string) {
  const normalized = normalizePhone(phone)
  const db = createSupabaseAdmin()
  // Normalize the configured phones too — env vars may be stored as 08.., 234..,
  // +234.. or with stray whitespace. Comparing raw strings was making the
  // super-admin/admin match fail, dropping them to the customer branch (→ /home).
  const superAdminPhone = safeNormalizePhone(process.env.SUPER_ADMIN_PHONE)
  const adminPhone = safeNormalizePhone(process.env.ADMIN_PHONE)

  if (superAdminPhone && normalized === superAdminPhone) {
    const { data: customer } = await db.from('customers').select(AUTH_USER_COLUMNS).eq('phone', normalized).maybeSingle()
    if (customer) return { role: 'super_admin' as const, table: 'customers', user: customer as unknown as AuthUserRow }

    const { data: admin } = await db.from('admins').select(AUTH_USER_COLUMNS).eq('phone', normalized).maybeSingle()
    if (admin) return { role: 'super_admin' as const, table: 'admins', user: admin as unknown as AuthUserRow }
  }

  if (adminPhone && normalized === adminPhone) {
    const { data: customer } = await db.from('customers').select(AUTH_USER_COLUMNS).eq('phone', normalized).maybeSingle()
    if (customer) return { role: 'admin' as const, table: 'customers', user: customer as unknown as AuthUserRow }

    const { data: admin } = await db.from('admins').select(AUTH_USER_COLUMNS).eq('phone', normalized).maybeSingle()
    if (admin) return { role: 'admin' as const, table: 'admins', user: admin as unknown as AuthUserRow }
  }

  const { data: vendor } = await db.from('vendors').select(AUTH_USER_COLUMNS).eq('phone', normalized).is('deleted_at', null).maybeSingle()
  if (vendor) return { role: 'vendor' as const, table: 'vendors', user: vendor as unknown as AuthUserRow }

  const { data: rider } = await db.from('riders').select(AUTH_USER_COLUMNS).eq('phone', normalized).is('deleted_at', null).maybeSingle()
  if (rider) return { role: 'rider' as const, table: 'riders', user: rider as unknown as AuthUserRow }

  const { data: admin } = await db.from('admins').select(AUTH_USER_COLUMNS).eq('phone', normalized).maybeSingle()
  if (admin) return { role: 'admin' as const, table: 'admins', user: admin as unknown as AuthUserRow }

  const { data: customer } = await db.from('customers').select(AUTH_USER_COLUMNS).eq('phone', normalized).is('deleted_at', null).maybeSingle()
  if (customer) return { role: 'customer' as const, table: 'customers', user: customer as unknown as AuthUserRow }

  return null
}

export async function findAuthUserById(role: SessionRole, id: string) {
  const db = createSupabaseAdmin()
  if (role === 'super_admin') {
    const { data: customer } = await db.from('customers').select(AUTH_USER_COLUMNS).eq('id', id).maybeSingle()
    if (customer) return { role, table: 'customers', user: customer as unknown as AuthUserRow }

    const { data: admin } = await db.from('admins').select(AUTH_USER_COLUMNS).eq('id', id).maybeSingle()
    if (admin) return { role, table: 'admins', user: admin as unknown as AuthUserRow }

    return null
  }

  let table: string
  if (role === 'admin') {
    table = 'admins'
  } else if (role === 'vendor') {
    table = 'vendors'
  } else if (role === 'rider') {
    table = 'riders'
  } else {
    table = 'customers'
  }
  const { data } = await db.from(table).select(AUTH_USER_COLUMNS).eq('id', id).maybeSingle()
  return data ? { table, user: data as unknown as AuthUserRow } : null
}

export async function logPinResetAudit(params: {
  user_id: string
  user_role: SessionRole
  reset_method: 'SECURITY_QUESTIONS' | 'RECOVERY_CODE' | 'ADMIN_OVERRIDE' | 'CHANGE_PIN' | 'OTP'
  ip_address?: string
  user_agent?: string
  succeeded?: boolean
}) {
  try {
    const db = createSupabaseAdmin()
    await db.from('pin_reset_audit').insert({
      user_id: params.user_id,
      user_role: params.user_role,
      reset_method: params.reset_method,
      ip_address: params.ip_address,
      user_agent: params.user_agent,
      succeeded: params.succeeded ?? true,
    })
  } catch (error) {
    console.error('[pin_reset_audit] failed to write audit entry', error)
  }
}
