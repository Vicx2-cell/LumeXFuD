export interface VendorSaleOrder {
  subtotal?: number | null
  status?: string | null
}

/**
 * The amount earned by a vendor for an order.
 *
 * Customer-facing totals also contain delivery and LumeX platform charges, so
 * they must never be used as vendor sales or earnings.
 */
export function vendorSaleKobo(order: VendorSaleOrder): number {
  const subtotal = Number(order.subtotal ?? 0)
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0
  return Math.round(subtotal)
}

export function completedVendorSalesKobo(orders: readonly VendorSaleOrder[]): number {
  return orders.reduce(
    (total, order) => total + (order.status === 'COMPLETED' ? vendorSaleKobo(order) : 0),
    0,
  )
}
