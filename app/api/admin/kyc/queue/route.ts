import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { docLabel } from '@/lib/kyc'

const BUCKET = 'kyc-faces'

// GET /api/admin/kyc/queue — everyone with documents AWAITING review, each with
// signed thumbnail URLs. Powers the dedicated /admin/kyc review screen so an
// admin sees new uploads in one place. Admin/super-admin only.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  // Folders under pending/ and verified/ are user ids (id === null = folder).
  // complete/ entries are the fully-verified markers.
  const [pf, vf, cf] = await Promise.all([
    db.storage.from(BUCKET).list('pending', { limit: 500 }),
    db.storage.from(BUCKET).list('verified', { limit: 500 }),
    db.storage.from(BUCKET).list('complete', { limit: 500 }),
  ])
  const pendingIds = (pf.data ?? []).filter((f) => f.id === null).map((f) => f.name)
  const verifiedIds = (cf.data ?? []).map((f) => f.name) // only fully-verified accounts
  const allIds = Array.from(new Set([...pendingIds, ...verifiedIds]))
  if (allIds.length === 0) return NextResponse.json({ pending: [], verified: [] })

  const [{ data: vendors }, { data: riders }] = await Promise.all([
    db.from('vendors').select('id, shop_name, phone').in('id', allIds),
    db.from('riders').select('id, full_name, phone').in('id', allIds),
  ])
  const acct = new Map<string, { name: string; role: string; phone: string }>()
  for (const v of (vendors ?? []) as Array<{ id: string; shop_name: string; phone: string }>) acct.set(v.id, { name: v.shop_name, role: 'vendor', phone: v.phone })
  for (const r of (riders ?? []) as Array<{ id: string; full_name: string; phone: string }>) acct.set(r.id, { name: r.full_name, role: 'rider', phone: r.phone })

  type Acct = { phone: string; name: string; role: string; docs: Array<{ key: string; label: string; url: string }> }
  async function docsIn(folder: 'pending' | 'verified', id: string): Promise<Acct['docs']> {
    const { data: files } = await db.storage.from(BUCKET).list(`${folder}/${id}`, { limit: 20 })
    const docs: Acct['docs'] = []
    for (const f of files ?? []) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(`${folder}/${id}/${f.name}`, 300)
      if (signed) docs.push({ key: f.name.replace(/\.webp$/, ''), label: docLabel(f.name.replace(/\.webp$/, '')), url: signed.signedUrl })
    }
    return docs
  }

  const pending: Acct[] = []
  for (const id of pendingIds) {
    const who = acct.get(id); if (!who) continue
    const docs = await docsIn('pending', id)
    if (docs.length) pending.push({ ...who, docs })
  }

  const verified: Acct[] = []
  for (const id of verifiedIds) {
    const who = acct.get(id); if (!who) continue
    const docs = await docsIn('verified', id)
    if (docs.length) verified.push({ ...who, docs })
  }

  return NextResponse.json({ pending, verified })
}
