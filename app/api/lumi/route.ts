import { NextResponse } from 'next/server'
import { matchIntent } from '@/lib/lumi/intents'
import * as actions from '@/lib/lumi/actions'
import { getState, setState, clearState } from '@/lib/lumi/state'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { userId, message } = body as { userId?: string; message?: string }
  if (!userId || !message) return NextResponse.json({ error: 'userId and message required' }, { status: 400 })

  // Check existing state
  const state = (await getState(userId)) || null

  // If there's an active conversation step, for now we just match intents fresh
  const { intent, entities } = matchIntent(message)

  let reply
  try {
    switch (intent) {
      case 'check_balance':
        reply = await actions.handleCheckBalance(userId)
        await clearState(userId)
        break
      case 'browse_vendors':
        reply = await actions.handleBrowseVendors()
        await clearState(userId)
        break
      case 'view_menu':
        reply = await actions.handleViewMenu(entities)
        await setState(userId, { step: 'view_menu', partial: { vendor: entities.vendor } })
        break
      case 'place_order':
        // Validate and prepare an order draft; client will confirm & POST to /api/orders
        reply = await actions.handlePlaceOrder(userId, entities)
        // store partial draft so /api/lumi/confirm can return it
        await setState(userId, { step: 'awaiting_order_confirmation', partial: { ...entities } })
        break
      case 'order_status':
        reply = await actions.handleOrderStatus(entities)
        await clearState(userId)
        break
      case 'fund_wallet':
        reply = await actions.handleFundWallet(userId, entities)
        await clearState(userId)
        break
      case 'withdraw':
        reply = await actions.handleWithdraw()
        await clearState(userId)
        break
      case 'cancel_order':
        reply = await actions.handleCancelOrder(userId, entities)
        await clearState(userId)
        break
      case 'help':
        reply = await actions.handleHelp()
        await clearState(userId)
        break
      case 'fallback':
      default:
        // log unmatched message
        const db = createSupabaseAdmin()
        try {
          await db.from('lumi_unmatched_messages').insert({ user_id: userId, message })
        } catch {
          // Unmatched-message logging must not block a user-facing fallback reply.
        }
        reply = { text: "Sorry, I didn't understand that. Try 'View vendors' or 'Check balance'.", quickReplies: ['View vendors', 'Check balance', 'Help'] }
        await clearState(userId)
        break
    }
  } catch (err) {
    reply = { text: 'Something went wrong. Try again later.', quickReplies: ['Help'] }
    await clearState(userId)
  }

  return NextResponse.json(reply)
}
