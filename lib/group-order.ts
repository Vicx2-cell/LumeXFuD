import crypto from 'crypto'

// Shareable group-order code: 6 chars, unambiguous alphabet (no 0/O/1/I/L) so it
// reads cleanly over WhatsApp. ~30^6 ≈ 730M combos; the DB UNIQUE constraint is
// the real guard (callers retry on the rare collision).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateGroupCode(len = 6): string {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return s
}
