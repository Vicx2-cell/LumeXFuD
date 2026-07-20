import { describe, expect, it } from 'vitest'
import { completedVendorSalesKobo, vendorSaleKobo } from './vendor-finance'

describe('vendor finance', () => {
  it('uses only the food subtotal as the vendor sale', () => {
    const order = {
      subtotal: 250_000,
      total_amount: 335_000,
      platform_markup: 15_000,
      delivery_fee: 70_000,
    }

    expect(vendorSaleKobo(order)).toBe(250_000)
  })

  it('totals completed vendor sales and ignores other statuses', () => {
    expect(completedVendorSalesKobo([
      { status: 'COMPLETED', subtotal: 100_000 },
      { status: 'COMPLETED', subtotal: 225_000 },
      { status: 'CANCELLED', subtotal: 500_000 },
      { status: 'PREPARING', subtotal: 75_000 },
    ])).toBe(325_000)
  })

  it('safely handles missing or invalid subtotals', () => {
    expect(vendorSaleKobo({ subtotal: null })).toBe(0)
    expect(vendorSaleKobo({ subtotal: Number.NaN })).toBe(0)
    expect(vendorSaleKobo({ subtotal: -100 })).toBe(0)
  })
})
