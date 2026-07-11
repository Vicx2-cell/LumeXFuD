import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: flyer } = await db
    .from('generated_flyers')
    .select('id, vendor_id, image_url, headline, event_type, variation')
    .eq('id', id)
    .maybeSingle()

  if (!flyer || flyer.vendor_id !== session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const response = await fetch(flyer.image_url, { cache: 'no-store' })
  if (!response.ok || !response.body) {
    return NextResponse.json({ error: 'Could not load flyer image' }, { status: 502 })
  }

  const filename = `lumex-flyer-${flyer.event_type}-${flyer.variation + 1}.png`
  return new NextResponse(response.body, {
    headers: {
      'content-type': response.headers.get('content-type') ?? 'image/png',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
