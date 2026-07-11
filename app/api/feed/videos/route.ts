import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { loadVendorVideoLibrary } from '@/lib/feed/lifecycle'

const querySchema = z.object({
  state: z.enum(['active', 'drafts', 'archived', 'processing', 'failed']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(24),
})

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = querySchema.safeParse({
    state: req.nextUrl.searchParams.get('state') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid query' }, { status: 400 })
  }
  try {
    const data = await loadVendorVideoLibrary(parsed.data.state, parsed.data.limit)
    return NextResponse.json({ ok: true, state: parsed.data.state, ...data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load videos' }, { status: 400 })
  }
}
