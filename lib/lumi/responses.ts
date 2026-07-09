import { formatPrice } from '@/lib/money'
import type { LumiQuickReply, LumiResponse } from './types'

function qr(id: string, label: string, value = id): LumiQuickReply {
  return { id, label, value }
}

export const lumiResponses = {
  help(): LumiResponse {
    return {
      reply: 'I can help you check your wallet, browse vendors, view menus, place an order, track an order, fund your wallet, or cancel an order.',
      quickReplies: [
        qr('check-balance', 'Check balance', 'check balance'),
        qr('browse-vendors', 'Browse vendors', 'show vendors'),
        qr('order-food', 'Order food', 'i want food'),
        qr('fund-wallet', 'Fund wallet', 'fund my wallet'),
      ],
    }
  },

  cancelled(): LumiResponse {
    return {
      reply: 'Okay, I cleared that flow.',
      quickReplies: [
        qr('browse-vendors', 'Browse vendors', 'show vendors'),
        qr('check-balance', 'Check balance', 'check my balance'),
      ],
    }
  },

  fallback(): LumiResponse {
    return {
      reply: 'I did not catch that. Try something like "check my balance", "show vendors", or "order 2 jollof rice".',
      quickReplies: [
        qr('help', 'Help', 'help'),
        qr('vendors', 'Browse vendors', 'show vendors'),
        qr('balance', 'Check balance', 'check my balance'),
      ],
    }
  },

  balance(balanceKobo: number): LumiResponse {
    return {
      reply: `Your wallet balance is ${formatPrice(balanceKobo)}.`,
      quickReplies: [
        qr('fund-wallet', 'Fund wallet', 'fund my wallet'),
        qr('browse-vendors', 'Browse vendors', 'show vendors'),
      ],
    }
  },

  browseVendors(vendors: Array<{ id: string; name: string }>): LumiResponse {
    if (vendors.length === 0) {
      return {
        reply: 'I could not find any open vendors right now.',
        quickReplies: [qr('help', 'Help', 'help')],
      }
    }
    return {
      reply: `Here are some vendors you can order from:\n${vendors.map((vendor) => `• ${vendor.name}`).join('\n')}`,
      quickReplies: vendors.slice(0, 4).map((vendor) => qr(`vendor-${vendor.id}`, vendor.name, `vendor:${vendor.id}`)),
      data: { vendors },
    }
  },

  chooseVendor(prompt: string, vendors: Array<{ id: string; name: string }>): LumiResponse {
    return {
      reply: prompt,
      quickReplies: vendors.slice(0, 5).map((vendor) => qr(`vendor-${vendor.id}`, vendor.name, `vendor:${vendor.id}`)).concat([
        qr('cancel-flow', 'Cancel', 'cancel'),
      ]),
      data: { vendors },
    }
  },

  menu(vendorName: string, items: Array<{ id: string; name: string; price: number; available: boolean }>): LumiResponse {
    if (items.length === 0) {
      return {
        reply: `I could not find any available menu items for ${vendorName} right now.`,
        quickReplies: [qr('browse-vendors', 'Browse vendors', 'show vendors')],
      }
    }
    return {
      reply: `${vendorName}'s menu:\n${items.map((item) => `• ${item.name} — ${formatPrice(item.price)}`).join('\n')}`,
      quickReplies: items.slice(0, 4).map((item) => qr(`menu-${item.id}`, item.name, `menu:${item.id}`)).concat([
        qr('cancel-flow', 'Cancel', 'cancel'),
      ]),
      data: { menuItems: items },
    }
  },

  askQuantity(itemName: string): LumiResponse {
    return {
      reply: `How many ${itemName} would you like?`,
      quickReplies: [
        qr('qty-1', '1', 'qty:1'),
        qr('qty-2', '2', 'qty:2'),
        qr('qty-3', '3', 'qty:3'),
        qr('cancel-flow', 'Cancel', 'cancel'),
      ],
    }
  },

  missingLocation(): LumiResponse {
    return {
      reply: 'I need an active delivery location before I can prepare an order. Open your saved places or place a regular order once your location is set.',
      quickReplies: [
        qr('open-locations', 'Saved places', '/profile/locations'),
        qr('browse-vendors', 'Browse vendors', 'show vendors'),
      ],
    }
  },

  confirmOrder(params: {
    vendorName: string
    itemName: string
    quantity: number
    subtotalKobo: number
    deliveryFeeKobo: number
    platformMarkupKobo: number
    totalKobo: number
    address: string
  }): LumiResponse {
    return {
      reply: [
        `Your order is ${params.quantity} × ${params.itemName} from ${params.vendorName}.`,
        `Subtotal: ${formatPrice(params.subtotalKobo)}`,
        `Platform fee: ${formatPrice(params.platformMarkupKobo)}`,
        `Delivery: ${formatPrice(params.deliveryFeeKobo)}`,
        `Total: ${formatPrice(params.totalKobo)}`,
        `Delivery to: ${params.address}`,
        'Confirm order?',
      ].join('\n'),
      quickReplies: [
        qr('confirm-order', 'Confirm order', 'confirm_order'),
        qr('cancel-flow', 'Cancel', 'cancel'),
      ],
    }
  },

  latestOrderStatus(order: { id: string; status: string; total: number }): LumiResponse {
    return {
      reply: `Your latest order ${order.id} is ${order.status}. Total: ${formatPrice(order.total)}.`,
      quickReplies: [
        qr('track-orders', 'Orders page', '/orders'),
        qr('cancel-order', 'Cancel order', 'cancel my order'),
      ],
      data: { order },
    }
  },

  fundWalletAskAmount(): LumiResponse {
    return {
      reply: 'How much would you like to add to your wallet?',
      quickReplies: [
        qr('fund-2000', '₦2,000', 'add 2000'),
        qr('fund-5000', '₦5,000', 'add 5000'),
        qr('fund-10000', '₦10,000', 'add 10000'),
        qr('cancel-flow', 'Cancel', 'cancel'),
      ],
    }
  },

  fundWalletConfirm(amountKobo: number): LumiResponse {
    return {
      reply: `I’m ready to start a wallet top-up for ${formatPrice(amountKobo)}. Continue to Paystack?`,
      quickReplies: [
        qr('confirm-funding', 'Continue', 'confirm_funding'),
        qr('cancel-flow', 'Cancel', 'cancel'),
      ],
    }
  },

  withdrawUnavailable(): LumiResponse {
    return {
      reply: 'Student wallet withdrawals are not available in this app. You can fund your wallet and spend it on orders.',
      quickReplies: [
        qr('fund-wallet', 'Fund wallet', 'fund my wallet'),
        qr('check-balance', 'Check balance', 'check my balance'),
      ],
    }
  },

  cancelOrderConfirm(orderNumber: string): LumiResponse {
    return {
      reply: `Do you want me to cancel order ${orderNumber}?`,
      quickReplies: [
        qr('confirm-cancel-order', 'Yes, cancel it', 'confirm_cancel_order'),
        qr('keep-order', 'Keep order', 'cancel'),
      ],
    }
  },

  orderNotFound(): LumiResponse {
    return {
      reply: 'I could not find that order on your account.',
      quickReplies: [qr('orders-page', 'Orders page', '/orders')],
    }
  },

  orderNotCancellable(): LumiResponse {
    return {
      reply: 'That order cannot be cancelled from chat anymore. If the vendor already accepted it, use the normal support flow after delivery if needed.',
      quickReplies: [qr('orders-page', 'Orders page', '/orders')],
    }
  },

  askOrderSelection(orders: Array<{ id: string; orderNumber: string }>): LumiResponse {
    return {
      reply: 'Which order do you want to cancel?',
      quickReplies: orders.slice(0, 4).map((order) => qr(`order-${order.id}`, order.orderNumber, `order:${order.id}`)).concat([
        qr('cancel-flow', 'Cancel', 'cancel'),
      ]),
    }
  },
}
