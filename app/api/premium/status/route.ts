import { NextResponse } from 'next/server'
import { loadPremiumStatus } from '@/lib/premium'
import { getCurrentUser } from '@/lib/session'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const status = await loadPremiumStatus()
    return NextResponse.json({ ok: true, status })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load premium status' }, { status: 400 })
  }
}
