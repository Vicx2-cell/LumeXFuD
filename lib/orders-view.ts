// Decides what the orders-history list should render. Kept as a pure function so
// the error-vs-empty distinction is unit-testable without a React renderer.
//
// The bug this guards against: a failed Supabase query returns `data: null` with
// an `error`, which looks identical to "no rows". Rendering the empty state on a
// load failure tells a customer they have *no orders* when the request merely
// failed — alarming on a platform that holds their money. Surface a retryable
// error state instead.
export type OrdersView = 'error' | 'empty' | 'list'

export function resolveOrdersView(
  orders: readonly unknown[] | null | undefined,
  error: unknown | null | undefined,
): OrdersView {
  if (error) return 'error'
  if (!orders || orders.length === 0) return 'empty'
  return 'list'
}
