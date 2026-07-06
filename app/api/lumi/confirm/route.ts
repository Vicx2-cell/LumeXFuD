import { NextResponse } from 'next/server'
import { getState, clearState } from '@/lib/lumi/state'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { userId } = body as { userId?: string }
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const state = await getState(userId)
  if (!state || state.step !== 'awaiting_order_confirmation' || !state.partial) {
    return NextResponse.json({ error: 'No pending order to confirm' }, { status: 404 })
  }
  // Return the draft to the client so it can POST to /api/orders with the user's session
  const draft = state.partial
  // Optionally clear state to avoid double-submits; client UI should handle retry semantics
  await clearState(userId)
  return NextResponse.json({ draft })
}
