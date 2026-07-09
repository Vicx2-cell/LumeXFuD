import { NextRequest, NextResponse } from 'next/server'
import { BADGE_MEANINGS } from '@/lib/badges'
import { getCurrentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

function explainBadge(id: string): string | null {
  const meaning = BADGE_MEANINGS[id]
  if (!meaning) return null
  return `${meaning.description} ${meaning.howto}`.trim()
}

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id') ?? ''
  const text = explainBadge(id)
  if (!text) return NextResponse.json({ text: null }, { status: 404 })
  return NextResponse.json({ text })
}
