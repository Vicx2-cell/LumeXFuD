import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { audit } from '@/lib/audit'
import { docsForRole } from '@/lib/kyc'

const BUCKET = 'kyc-faces'

async function authAdmin() {
  const session = await getCurrentUser()
  if (!session) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null }
  if (!['admin', 'super_admin'].includes(session.role)) return { err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), session: null }
  return { err: null, session }
}

async function resolveAccount(db: ReturnType<typeof createSupabaseAdmin>, phone: string): Promise<{ id: string; role: string } | null> {
  for (const [t, role] of [['vendors', 'vendor'], ['riders', 'rider'], ['customers', 'customer']] as const) {
    const { data } = await db.from(t).select('id').eq('phone', phone).maybeSingle()
    if (data) return { id: (data as { id: string }).id, role }
  }
  return null
}

// After any approve/reject, recompute whether ALL required docs are verified and
// write/remove a flat `complete/<id>` marker. Customers read this one cheap list
// to show the Verified badge — no per-vendor storage scan, no DB column.
async function refreshComplete(db: ReturnType<typeof createSupabaseAdmin>, id: string, role: string): Promise<void> {
  const required = docsForRole(role)
  if (required.length === 0) return
  const { data: vfiles } = await db.storage.from(BUCKET).list(`verified/${id}`, { limit: 100 })
  const verified = new Set((vfiles ?? []).map((f) => f.name.replace(/\.webp$/, '')))
  const allDone = required.every((d) => verified.has(d.key))
  if (allDone) {
    // The bucket only allows image mime types, so the marker is a 1×1 PNG.
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await db.storage.from(BUCKET).upload(`complete/${id}`, PNG, { upsert: true, contentType: 'image/png' }).catch(() => {})
  } else {
    await db.storage.from(BUCKET).remove([`complete/${id}`]).catch(() => {})
  }
}

// GET /api/admin/face?phone=…  — signed URL to the user's KYC selfie + its
// verification state (verified | pending | none). Viewing is audited.
export async function GET(req: NextRequest) {
  const { err, session } = await authAdmin()
  if (err || !session) return err!

  let phone: string
  try { phone = normalizePhone(req.nextUrl.searchParams.get('phone') ?? '') } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }

  const doc = (req.nextUrl.searchParams.get('doc') || 'face').replace(/[^a-z_]/g, '')

  const db = createSupabaseAdmin()
  const acct = await resolveAccount(db, phone)
  if (!acct) return NextResponse.json({ error: 'No account found' }, { status: 404 })
  const id = acct.id

  for (const folder of ['verified', 'pending'] as const) {
    const { data } = await db.storage.from(BUCKET).createSignedUrl(`${folder}/${id}/${doc}.webp`, 120)
    if (data) {
      await audit({ actor_id: session.phone, actor_role: session.role, action: 'kyc_face_viewed', target_table: 'kyc-faces', target_id: phone.slice(-4).padStart(phone.length, '*') })
      return NextResponse.json({ found: true, url: data.signedUrl, verified: folder === 'verified' })
    }
  }
  return NextResponse.json({ found: false })
}

const postInput = z.object({
  phone:  z.string().min(7).max(20),
  action: z.enum(['approve', 'reject', 'revoke']),
  doc:    z.string().regex(/^[a-z_]+$/).max(20).optional().default('face'),
})

// POST /api/admin/face  — approve (pending → verified) or reject (delete).
export async function POST(req: NextRequest) {
  const { err, session } = await authAdmin()
  if (err || !session) return err!

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = postInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  let phone: string
  try { phone = normalizePhone(parsed.data.phone) } catch { return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 400 }) }

  const doc = parsed.data.doc
  const db = createSupabaseAdmin()
  const acct = await resolveAccount(db, phone)
  if (!acct) return NextResponse.json({ error: 'No account found' }, { status: 404 })
  const id = acct.id

  if (parsed.data.action === 'approve') {
    const { error: mvErr } = await db.storage.from(BUCKET).move(`pending/${id}/${doc}.webp`, `verified/${id}/${doc}.webp`)
    if (mvErr && !/exists|not found/i.test(mvErr.message)) {
      return NextResponse.json({ error: 'Could not approve document' }, { status: 500 })
    }
  } else if (parsed.data.action === 'revoke') {
    // Un-approve the whole account: move every verified doc back to pending for
    // re-review and drop the badge. Images are kept (no re-upload needed).
    const { data: vfiles } = await db.storage.from(BUCKET).list(`verified/${id}`, { limit: 100 })
    for (const f of vfiles ?? []) {
      await db.storage.from(BUCKET).move(`verified/${id}/${f.name}`, `pending/${id}/${f.name}`).catch(() => {})
    }
  } else {
    // reject → remove both, so the user must re-upload that document.
    await db.storage.from(BUCKET).remove([`pending/${id}/${doc}.webp`, `verified/${id}/${doc}.webp`])
  }

  // Recompute the customer-facing "fully verified" marker.
  await refreshComplete(db, id, acct.role)

  await audit({
    actor_id: session.phone, actor_role: session.role,
    action: parsed.data.action === 'approve' ? 'kyc_doc_approved' : parsed.data.action === 'revoke' ? 'kyc_revoked' : 'kyc_doc_rejected',
    target_table: 'kyc-faces', target_id: `${phone.slice(-4).padStart(phone.length, '*')}:${parsed.data.action === 'revoke' ? 'all' : doc}`,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, action: parsed.data.action, doc })
}
