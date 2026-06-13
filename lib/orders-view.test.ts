import { describe, it, expect } from 'vitest'
import { resolveOrdersView } from './orders-view'

describe('resolveOrdersView', () => {
  it('returns "list" when there are orders', () => {
    expect(resolveOrdersView([{ id: '1' }], null)).toBe('list')
  })

  it('returns "empty" when the query succeeded with no rows', () => {
    expect(resolveOrdersView([], null)).toBe('empty')
    expect(resolveOrdersView(null, null)).toBe('empty')
    expect(resolveOrdersView(undefined, null)).toBe('empty')
  })

  it('returns "error" when the query failed, even if data is null/empty', () => {
    expect(resolveOrdersView(null, { message: 'boom' })).toBe('error')
    expect(resolveOrdersView([], { message: 'boom' })).toBe('error')
  })

  it('prefers "error" over data: a partial/stale result alongside an error is still an error', () => {
    // Defensive: if a client ever returns both rows and an error, do not mask the failure.
    expect(resolveOrdersView([{ id: '1' }], { message: 'boom' })).toBe('error')
  })
})
