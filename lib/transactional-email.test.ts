import { beforeEach, describe, expect, it, vi } from 'vitest'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))

vi.mock('./email', async (importOriginal) => {
  const original = await importOriginal<typeof import('./email')>()
  return { ...original, sendTransactionalEmail: transport }
})

import {
  sendOrderConfirmationEmail,
  sendDelayedOrderEmail,
  sendOrderStatusEmail,
  sendWelcomeEmail,
  shouldSendWelcomeForEmailChange,
} from './transactional-email'
import { renderDelayedOrderEmail, renderOrderConfirmationEmail, renderOrderStatusEmail, renderWelcomeEmail } from './email-templates'

type Row = Record<string, unknown>
type Event = { id: string; status: string; recipient: string }

class Query implements PromiseLike<{ data: Row[] | null; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private updateValues: Row | null = null

  constructor(private readonly db: FakeDb, private readonly table: string) {}
  select(): this { return this }
  update(values: Row): this { this.updateValues = values; return this }
  eq(column: string, value: unknown): this { this.filters.push((row) => row[column] === value); return this }
  is(column: string, value: unknown): this { this.filters.push((row) => row[column] === value); return this }
  private rows(): Row[] { return (this.db.tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row))) }
  private execute(): { data: Row[]; error: null } {
    const rows = this.rows()
    if (this.updateValues) rows.forEach((row) => Object.assign(row, this.updateValues))
    return { data: rows, error: null }
  }
  async maybeSingle(): Promise<{ data: Row | null; error: null }> { return { data: this.execute().data[0] ?? null, error: null } }
  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return Promise.resolve(this.execute()).then(onfulfilled, onrejected) }
}

class FakeDb {
  tables: Record<string, Row[]> = { customers: [], orders: [], vendors: [], order_items: [] }
  events = new Map<string, Event>()
  from(table: string): Query { return new Query(this, table) }
  async rpc(name: string, params: Row): Promise<{ data: Row[] | null; error: null }> {
    if (name === 'claim_transactional_email_event') {
      const key = String(params.p_event_key)
      const existing = this.events.get(key)
      if (existing && existing.status !== 'FAILED') return { data: [{ event_id: existing.id, claimed: false }], error: null }
      const event = existing ?? { id: `event-${this.events.size + 1}`, status: 'PROCESSING', recipient: String(params.p_recipient) }
      event.status = 'PROCESSING'
      this.events.set(key, event)
      return { data: [{ event_id: event.id, claimed: true }], error: null }
    }
    if (name === 'finish_transactional_email_event') {
      const event = [...this.events.values()].find((value) => value.id === params.p_event_id)
      if (event) event.status = String(params.p_status)
    }
    return { data: [], error: null }
  }
}

function emailDb(): FakeDb {
  const db = new FakeDb()
  db.tables.customers.push({ id: 'customer-1', email: 'ada@example.com', name: 'Ada Nwosu', welcome_email_sent_at: null })
  db.tables.vendors.push({ id: 'vendor-1', shop_name: 'Mama K’s Kitchen' })
  db.tables.orders.push({
    id: 'order-1', order_number: 'LXF-2026-000001', customer_id: 'customer-1', vendor_id: 'vendor-1',
    subtotal: 250000, delivery_fee: 50000, platform_markup: 15000, tip_amount: 0, reward_discount_kobo: 10000,
    total_amount: 305000, payment_status: 'PAID', delivery_type: 'BIKE', delivery_address: 'Private room',
    delivery_lodge: 'Umuahia Hall', delivery_block: 'B Block',
  })
  db.tables.order_items.push({ order_id: 'order-1', name: 'Jollof rice', quantity: 2, subtotal: 250000 })
  return db
}

type ServiceDb = Parameters<typeof sendWelcomeEmail>[0]

describe('transactional email behavior', () => {
  beforeEach(() => {
    transport.mockReset()
    transport.mockResolvedValue({ status: 'sent', id: 'resend-1' })
  })

  it('sends one welcome email for a new signup with a valid email', async () => {
    const db = emailDb()
    const first = await sendWelcomeEmail(db as unknown as ServiceDb, { customerId: 'customer-1', email: 'ADA@example.com', name: 'Ada Nwosu' })
    const duplicate = await sendWelcomeEmail(db as unknown as ServiceDb, { customerId: 'customer-1', email: 'ada@example.com', name: 'Ada Nwosu' })
    expect(first.status).toBe('sent')
    expect(duplicate).toEqual({ status: 'skipped', reason: 'already_processed' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(db.tables.customers[0].welcome_email_sent_at).toEqual(expect.any(String))
  })

  it('sends no welcome email when signup has no valid email', async () => {
    const result = await sendWelcomeEmail(emailDb() as unknown as ServiceDb, { customerId: 'customer-1', email: null, name: null })
    expect(result).toEqual({ status: 'skipped', reason: 'no_recipient' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('only selects the first valid email addition for welcome', () => {
    expect(shouldSendWelcomeForEmailChange({ previousEmail: null, nextEmail: 'new@example.com', welcomeEmailSentAt: null })).toBe(true)
    expect(shouldSendWelcomeForEmailChange({ previousEmail: 'old@example.com', nextEmail: 'new@example.com', welcomeEmailSentAt: null })).toBe(false)
    expect(shouldSendWelcomeForEmailChange({ previousEmail: null, nextEmail: 'new@example.com', welcomeEmailSentAt: '2026-01-01' })).toBe(false)
  })

  it('sends order confirmation once even when payment processing repeats', async () => {
    const db = emailDb()
    const first = await sendOrderConfirmationEmail(db as unknown as ServiceDb, { orderId: 'order-1' })
    const repeatedWebhook = await sendOrderConfirmationEmail(db as unknown as ServiceDb, { orderId: 'order-1' })
    expect(first.status).toBe('sent')
    expect(repeatedWebhook).toEqual({ status: 'skipped', reason: 'already_processed' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0].html).toContain('Jollof rice')
    expect(transport.mock.calls[0][0].html).toContain('Umuahia Hall')
    expect(transport.mock.calls[0][0].html).not.toContain('Private room')
  })

  it('sends relevant status changes once and ignores irrelevant updates', async () => {
    const db = emailDb()
    const sent = await sendOrderStatusEmail(db as unknown as ServiceDb, { orderId: 'order-1', newStatus: 'PICKED_UP', statusEventId: 'status-1' })
    const duplicate = await sendOrderStatusEmail(db as unknown as ServiceDb, { orderId: 'order-1', newStatus: 'PICKED_UP', statusEventId: 'status-2' })
    const irrelevant = await sendOrderStatusEmail(db as unknown as ServiceDb, { orderId: 'order-1', newStatus: 'RIDER_ASSIGNED', statusEventId: 'status-3' })
    expect(sent.status).toBe('sent')
    expect(duplicate.status).toBe('skipped')
    expect(irrelevant).toEqual({ status: 'skipped', reason: 'irrelevant_status' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0].text).toContain('out for delivery')
  })

  it('deduplicates delivered email across DELIVERED and COMPLETED events', async () => {
    const db = emailDb()
    const delivered = await sendOrderStatusEmail(db as unknown as ServiceDb, { orderId: 'order-1', newStatus: 'DELIVERED', statusEventId: 'status-1' })
    const completed = await sendOrderStatusEmail(db as unknown as ServiceDb, { orderId: 'order-1', newStatus: 'COMPLETED', statusEventId: 'status-2' })
    expect(delivered.status).toBe('sent')
    expect(completed).toEqual({ status: 'skipped', reason: 'already_processed' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0].text).toContain('quick rating')
  })

  it('sends one delayed-order email even when the delay watcher repeats', async () => {
    const db = emailDb()
    const first = await sendDelayedOrderEmail(db as unknown as ServiceDb, { orderId: 'order-1', projectedDeliveryAt: '2026-07-20T12:30:00Z' })
    const repeat = await sendDelayedOrderEmail(db as unknown as ServiceDb, { orderId: 'order-1', projectedDeliveryAt: '2026-07-20T12:35:00Z' })
    expect(first.status).toBe('sent')
    expect(repeat).toEqual({ status: 'skipped', reason: 'already_processed' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('returns a failure without throwing or undoing the claimed business event', async () => {
    transport.mockResolvedValueOnce({ status: 'failed', code: 'transport_error' })
    const db = emailDb()
    const result = await sendOrderConfirmationEmail(db as unknown as ServiceDb, { orderId: 'order-1' })
    expect(result).toEqual({ status: 'failed', code: 'transport_error' })
    expect(db.tables.orders[0].payment_status).toBe('PAID')
    expect([...db.events.values()][0].status).toBe('FAILED')
  })
})

describe('email templates', () => {
  it('renders safely when optional values are missing', () => {
    const welcome = renderWelcomeEmail({ name: null, exploreUrl: 'https://lumexfud.com.ng' })
    const confirmation = renderOrderConfirmationEmail({
      customerName: null, orderNumber: 'LXF-2026-000001', vendorName: 'Vendor', items: [], subtotal: 0,
      deliveryFee: 0, platformFee: 0, tip: 0, discount: 0, total: 0, paymentStatus: 'Paid',
      deliveryMethod: 'Pickup', deliveryLocation: 'Campus pickup', orderUrl: 'https://lumexfud.com.ng/order/1',
    })
    const status = renderOrderStatusEmail({ customerName: null, orderNumber: 'LXF-2026-000001', vendorName: null, status: 'COMPLETED', orderUrl: 'https://lumexfud.com.ng/order/1' })
    const delayed = renderDelayedOrderEmail({ customerName: null, orderNumber: 'LXF-2026-000001', vendorName: null, projectedDeliveryAt: null, orderUrl: 'https://lumexfud.com.ng/order/1' })
    expect(welcome.html).toContain('Hey there')
    expect(welcome.text).toContain('I read every email')
    expect(confirmation.text).toContain('Order items are available')
    expect(confirmation.text).toContain('We’ll keep you updated')
    expect(status.html).toContain('Delivered. How did we do?')
    expect(delayed.text).toContain('Hey there')
  })
})
