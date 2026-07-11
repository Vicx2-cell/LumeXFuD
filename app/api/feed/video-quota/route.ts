import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getVideoQuotaForVendor } from '@/lib/feed/video-management'

export async function GET() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor' || !session.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', session.userId).maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Vendor profile not found' }, { status: 404 })

  const quota = await getVideoQuotaForVendor(String((profile as { id: string }).id))
  return NextResponse.json({ ok: true, quota })
}

