import crypto from 'crypto'

// Field-level encryption for sensitive data at rest (e.g. bank account numbers).
// AES-256-GCM (authenticated): tampering is detected on decrypt.
//
// ENCRYPTION_KEY must be 32 bytes, supplied as 64 hex chars or base64.
// Generate one with:  openssl rand -hex 32

const ALGO = 'aes-256-gcm'
const PREFIX = 'enc:v1:'

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY not set — cannot encrypt/decrypt sensitive fields')
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)')
  return buf
}

/** Encrypt a string. Output: `enc:v1:<iv>:<tag>:<ciphertext>` (all base64). */
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/**
 * Decrypt a value produced by encryptField. Values WITHOUT the `enc:v1:`
 * prefix are treated as legacy plaintext and returned as-is — so existing
 * rows keep working until they're next saved (and re-encrypted).
 */
export function decryptField(value: string): string {
  if (!value.startsWith(PREFIX)) return value
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':')
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

/** True if a value is already encrypted (has the marker prefix). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}
