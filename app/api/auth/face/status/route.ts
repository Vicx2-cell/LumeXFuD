import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { docsForRole, type DocState } from '@/lib/kyc'

// GET /api/auth/face/status — per-document KYC state for the signed-in vendor/
// rider. Gates the dashboards (blocks until the selfie is on file) and powers the
// documents panel. Customers/admins/super-admins are exempt.
export async function GET() {
  const session = await getCurrentUser()
  if (!session || !session.userId) return NextResponse.json({ has_face: true, verified: true, exempt: true })
  if (session.role !== 'vendor' && session.role !== 'rider') {
    return NextResponse.json({ has_face: true, verified: true, exempt: true })
  }

  const required = docsForRole(session.role)
  try {
    const db = createSupabaseAdmin()
    const [vr, pr] = await Promise.all([
      db.storage.from('kyc-faces').list(`verified/${session.userId}`, { limit: 100 }),
      db.storage.from('kyc-faces').list(`pending/${session.userId}`, { limit: 100 }),
    ])
    const verified = new Set((vr.data ?? []).map((f) => f.name.replace(/\.webp$/, '')))
    const pending = new Set((pr.data ?? []).map((f) => f.name.replace(/\.webp$/, '')))

    const docs: Record<string, DocState> = {}
    for (const d of required) {
      docs[d.key] = verified.has(d.key) ? 'verified' : pending.has(d.key) ? 'pending' : 'none'
    }
    const allVerified = required.every((d) => docs[d.key] === 'verified')

    return NextResponse.json({
      has_face: docs.face === 'verified' || docs.face === 'pending',
      verified: allVerified,
      docs,
    })
  } catch {
    return NextResponse.json({ has_face: true, verified: true }) // never lock out on a blip
  }
}
