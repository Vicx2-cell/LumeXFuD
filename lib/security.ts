import crypto from 'crypto'

// ─── HMAC ─────────────────────────────────────────────────────────────────────

export function verifyHMAC(rawBody: string, signature: string, secret: string): boolean {
  // Paystack signs with a lowercase hex HMAC-SHA512. Decode both sides to raw
  // bytes and length-check the BUFFERS before the constant-time compare, so a
  // malformed/forged signature string fails closed (returns false) instead of
  // throwing on a buffer-size mismatch inside timingSafeEqual.
  try {
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest()
    const sig = Buffer.from(signature, 'hex')
    if (sig.length !== hash.length) return false
    return crypto.timingSafeEqual(hash, sig)
  } catch {
    return false
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// ─── INPUT SANITIZATION ───────────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s]*/gi
const PHONE_PATTERN = /(\+?\d[\d\s\-().]{7,}\d)/g

/** Strip URLs from user-supplied text */
export function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, '[link removed]')
}

/** Strip phone numbers from user-supplied text */
export function stripPhoneNumbers(text: string): string {
  return text.replace(PHONE_PATTERN, '[number removed]')
}

/** Sanitize user-supplied text for storage/display */
export function sanitize(text: string): string {
  return stripUrls(stripPhoneNumbers(text)).trim()
}

// ─── SSRF / PRIVATE IP BLOCK ──────────────────────────────────────────────────

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./, // AWS metadata & link-local
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
]

export function isPrivateIP(host: string): boolean {
  return PRIVATE_IP_RANGES.some((rx) => rx.test(host))
}

// ─── IMAGE MAGIC BYTES ────────────────────────────────────────────────────────

const ALLOWED_MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header (needs extra check)
]

export function detectImageMime(buffer: Buffer): string | null {
  for (const { mime, bytes } of ALLOWED_MAGIC) {
    if (bytes.every((b, i) => buffer[i] === b)) {
      // For WebP, also confirm bytes 8-11 are 'WEBP'
      if (mime === 'image/webp') {
        const webp = buffer.slice(8, 12).toString('ascii')
        if (webp !== 'WEBP') continue
      }
      return mime
    }
  }
  return null
}

// ─── ORIGIN CHECK (CSRF) ──────────────────────────────────────────────────────

export function isAllowedOrigin(origin: string | null): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return false
  if (!origin) return false
  return origin === appUrl || origin === appUrl.replace(/\/$/, '')
}
