import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { buildConfirmationPayload, createLumiContext } from '@/lib/lumi/actions'
import { clearState, getState } from '@/lib/lumi/state'

export async function POST() {
  const session = await getCurrentUser()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ctx = await createLumiContext(session)
  if (!ctx) {
    return NextResponse.json({ error: 'Customer profile not found.' }, { status: 404 })
  }

  const state = await getState(ctx.customerId)
  const payload = await buildConfirmationPayload(ctx, state)
  if (!payload) {
    return NextResponse.json({ error: 'No pending Lumi confirmation was found.' }, { status: 404 })
  }

  await clearState(ctx.customerId)
  return NextResponse.json(payload)
}
