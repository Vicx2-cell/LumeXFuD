export type LumiReply = {
  text: string
  quickReplies?: string[]
}

export const templates = {
  balance: (nairaAmount: number): LumiReply => ({
    text: `Your wallet balance is ₦${Math.round(nairaAmount).toLocaleString()}.`,
    quickReplies: ['Top up', 'View vendors'],
  }),
  browseVendors: (vendors: { id: string; name: string }[]): LumiReply => ({
    text: vendors.length
      ? `Vendors near you:\n${vendors.map((v) => `- ${v.name}`).join('\n')}`
      : 'No vendors found right now.',
    quickReplies: vendors.slice(0, 3).map((v) => `View ${v.name}`),
  }),
  viewMenu: (vendorName: string, items: { name: string; price: number }[]): LumiReply => ({
    text: items.length
      ? `${vendorName} menu:\n${items.map((it) => `- ${it.name} — ₦${Math.round(it.price)}`).join('\n')}`
      : `No menu found for ${vendorName}.`,
    quickReplies: ['Order', 'Back to vendors'],
  }),
  placeOrderConfirm: (summary: string, total: number): LumiReply => ({
    text: `Order summary:\n${summary}\nTotal: ₦${Math.round(total)}\nConfirm order?`,
    quickReplies: ['Yes, place order', 'Change items', 'Cancel'],
  }),
  orderPlaced: (orderNumber: string): LumiReply => ({
    text: `Order placed ✅ — ${orderNumber}. Track it on Orders page.`,
    quickReplies: ['Track order', 'Order again'],
  }),
  orderStatus: (status: string): LumiReply => ({
    text: `Your order is currently: ${status}.`,
    quickReplies: ['Track', 'Contact support'],
  }),
  fundWallet: (amount: number): LumiReply => ({
    text: `To add ₦${Math.round(amount)} to your wallet, open the Wallet top-up page.`,
    quickReplies: ['Open Wallet', 'Help'],
  }),
  withdrawNotAvailable: (): LumiReply => ({
    text: `Withdrawals are not available. Money deposited can only be spent in-app.`,
    quickReplies: ['View Wallet', 'Help'],
  }),
  cancelOrder: (ok: boolean): LumiReply => ({
    text: ok ? 'Order cancelled.' : 'Unable to cancel order.',
    quickReplies: ['Help'],
  }),
  help: (): LumiReply => ({
    text: `I can help you check your wallet, browse vendors, view menus, place orders, or show order status.`,
    quickReplies: ['View vendors', 'Check balance', 'Help'],
  }),
  fallback: (): LumiReply => ({ text: "Sorry, I didn't understand that. Try: 'View vendors' or 'Check balance'.", quickReplies: ['View vendors', 'Check balance', 'Help'] }),
}
