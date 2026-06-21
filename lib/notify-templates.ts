/** All notification templates. Variables in {braces}. */
export const TEMPLATES = {
  // ─── Order Lifecycle ─────────────────────────────────────────────────────
  ORDER_PENDING: `📦 New order #{order_number}! ₦{total} from {customer_first_name}.\nItems: {items_summary}\nAccept within 5 minutes or it auto-cancels.\nOpen dashboard: {dashboard_url}`,

  VENDOR_ACCEPTED: `✅ Order confirmed! {vendor_name} is preparing your food.\nETA: {arrival_time}\nTrack here: {tracking_url}`,

  ORDER_READY: `🚨🚨 Delivery available!\nPickup: {vendor_name}\nDrop: {hostel}\nPay: ₦{rider_cut}\nOpen app to accept.`,

  RIDER_ASSIGNED: `🏍️ {rider_first_name} is on the way to pick up your food.\nETA: {arrival_time}\nTrack: {tracking_url}`,

  PICKED_UP: `🏃 Your food is on the way!\n{rider_first_name} should arrive by {arrival_time}.\nCall rider: {rider_phone}`,

  DELIVERED: `✅ Food delivered!\nConfirm receipt or report a problem: {confirm_url}\nThis auto-closes in 15 minutes.`,

  COMPLETED: `💰 ₦{amount} added to your wallet from delivery #{order_number}.\nAvailable for withdrawal in {hours} hours.\nGreat job!`,

  DISPUTED: `‼️‼️ DISPUTE on #{order_number}\nReason: {dispute_reason}\nCustomer: {customer_phone}\nVendor: {vendor_name}\nReview now: {admin_url}`,

  CANCELLED: `❌ Your order #{order_number} was cancelled.\nReason: {cancellation_reason}\nNo charge was made to your account.`,

  // ─── Pickup (Order Ahead) ───────────────────────────────────────────────────
  // NEVER include the collection code here (Invariant I3 — the code is shown only
  // in the customer's app). This message just tells them it's ready to collect.
  PICKUP_READY: `🛍️ Your order #{order_number} is ready at {vendor_name}!\nOpen the LumeX app to see your collection code and show it to the vendor.\nPlease collect within {window} minutes.`,

  // ─── Wallet ───────────────────────────────────────────────────────────────
  WITHDRAWAL_SUCCESS: `💰 ₦{amount} sent to your {bank_name} account ({last_4}).\nTransaction ref: {reference}\nShould arrive within 5 minutes.`,

  WITHDRAWAL_FAILED: `❌ Withdrawal of ₦{amount} failed.\nReason: {failure_reason}\nBalance refunded to your wallet.\nTry again or contact support.`,

  BANK_ADDED: `💳 New bank account added: {bank_name} - {last_4}\nFor security, withdrawals to this account are locked for 24 hours.\nFirst withdrawal allowed at: {unlock_time}\nWasn't you? Contact support immediately.`,

  WALLET_FROZEN: `🥶 Your LumeX wallet has been temporarily frozen for review.\nThis is for your protection.\nContact support: {support_url}`,

  WALLET_PIN_CHANGED: `🔑 Your wallet PIN was just changed.\nIf this wasn't you, reset immediately: {reset_url}`,

  // ─── Subscription ─────────────────────────────────────────────────────────
  SUBSCRIPTION_EXPIRY_DAY_1: `⚠️ Your LumeX Fud subscription expired today.\nPay ₦{amount} to keep accepting orders.\nPay now: {pay_url}\nGrace period: 3 days.`,

  SUBSCRIPTION_EXPIRY_DAY_2: `‼️ Second reminder: subscription payment overdue.\n₦{amount} - pay now to avoid deactivation: {pay_url}`,

  SUBSCRIPTION_EXPIRY_DAY_3: `⛔ FINAL WARNING: Your platform access ends tonight.\nPay ₦{amount} now to stay active: {pay_url}\nAfter tonight, your shop will be hidden from customers.`,

  SUBSCRIPTION_PAID: `✅ Subscription paid. Active until {expiry_date}.\nThank you for being part of LumeX Fud.`,

  SUBSCRIPTION_DEACTIVATED: `❌ Your subscription is overdue and your shop has been hidden from customers.\nReactivate anytime: {pay_url}`,

  // ─── Refunds ──────────────────────────────────────────────────────────────
  REFUND_INITIATED: `↩️ Your refund of ₦{amount} for order #{order_number} is being processed.\nShould arrive in your account within 24 hours.`,

  REFUND_PROCESSED: `✅ Refund of ₦{amount} sent to your account.\nOrder #{order_number}\nSorry for the inconvenience.`,

  REFUND_FAILED: `❌ Refund failed for order #{order_number}\nAmount: ₦{amount}\nReason: {failure_reason}\nManual intervention needed: {admin_url}`,

  // ─── Security ─────────────────────────────────────────────────────────────
  NEW_DEVICE_LOGIN: `🚨 New device logged into your LumeX account.\nDevice: {device_info}\nLocation: {city}\nTime: {time}\nWasn't you? Revoke access: {revoke_url}`,

  SUSPICIOUS_ACTIVITY: `🕵️ Suspicious activity detected\nUser: {phone}\nPattern: {pattern}\nIP: {ip}\nReview: {admin_url}`,

  RECONCILIATION_MISMATCH: `‼️ URGENT: Wallet reconciliation failed\nTotal wallet balance: ₦{wallet_total}\nPaystack balance: ₦{paystack_balance}\nDifference: ₦{difference}\nAll withdrawals frozen. Investigate immediately.`,

  ADMIN_LOGIN: `🛡️ Admin {admin_name} logged in\nDevice: {device}\nIP: {ip}\nTime: {time}`,

  OTP_LOCKOUT: `🔒 Your account is temporarily locked due to too many OTP attempts.\nTry again in 30 minutes.\nIf this wasn't you: {support_url}`,

  // ─── Gamification ─────────────────────────────────────────────────────────
  STREAK_AT_RISK: `🔥 Your {streak}-day streak ends tonight at midnight.\nOrder anything to keep it alive: {app_url}\nYou have {freezes} streak freeze remaining.`,

  STREAK_BROKEN: `💔 Your {streak}-day streak ended.\nOrder today to start a new one: {app_url}`,

  BADGE_EARNED: `🏅 New badge earned: {badge_emoji} {badge_name}!\n{badge_description}\n+{xp} XP\nCheck your profile: {profile_url}`,

  LEVEL_UP: `✨ Level up! You are now: {new_level}\nTotal XP: {total_xp}\nKeep ordering to unlock the next level.`,

  WEEKLY_LEADERBOARD_TOP_3: `🏆 You finished #{rank} on this week's leaderboard with {orders} orders!\nA new week starts now — keep ordering: {app_url}`,

  // ─── Messages ─────────────────────────────────────────────────────────────
  MESSAGE_UNREAD_5MIN: `💬 {sender_name} sent a message about order #{order_number}:\n'{message_preview}'\nReply: {order_url}`,
} as const

export type TemplateName = keyof typeof TEMPLATES

/** Render a template by substituting {key} placeholders */
export function renderTemplate(name: TemplateName, vars: Record<string, string | number>): string {
  let msg = TEMPLATES[name] as string
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replaceAll(`{${k}}`, String(v))
  }
  return msg
}
