import { createHmac } from 'crypto'

// Tamper-evident transaction receipts (Apple-style "verifiable proof"). Each
// receipt carries a short code = HMAC-SHA256 over the transaction's immutable
// fields, keyed by a server-only secret. You cannot forge a valid code without
// the secret, and changing ANY field (amount, type, date…) changes the code — so
// a screenshotted/exported receipt is self-verifying and a doctored ledger row
// is detectable. The secret never leaves the server.

const SECRET = process.env.RECEIPT_SECRET || process.env.JWT_SECRET || ''

export interface ReceiptFields {
  id: string
  reference: string | null
  amount: number | string
  type: string
  created_at: string
}

// e.g. "A1B2-C3D4-E5F6-7890" — 16 hex chars, grouped for readability.
export function receiptCode(f: ReceiptFields): string {
  const canonical = [f.id, f.reference ?? '', String(f.amount), f.type, f.created_at].join('|')
  const hex = createHmac('sha256', SECRET).update(canonical).digest('hex').slice(0, 16).toUpperCase()
  return hex.replace(/(.{4})(?=.)/g, '$1-')
}

export function verifyReceiptCode(f: ReceiptFields, code: string): boolean {
  // Constant-ish comparison; codes are short + non-secret, timing isn't sensitive.
  return receiptCode(f) === code.trim().toUpperCase()
}
