import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FAQ_ITEMS,
  FAQ_ROLES,
  buildFaqJsonLd,
  filterFaqItems,
  findFaqByHash,
  getKeyboardNavigationIndex,
  toggleFaqItem,
} from '@/lib/faq'

describe('FAQ search and tabs', () => {
  it('searches question, answer, category, and keywords without case sensitivity', () => {
    expect(filterFaqItems('customers', 'PAYSTACK').map((item) => item.id)).toContain('payments')
    expect(filterFaqItems('customers', 'preparing rider status').map((item) => item.id)).toEqual(['tracking'])
    expect(filterFaqItems('vendors', 'sold OUT').map((item) => item.id)).toEqual(['vendor-menu'])
    expect(filterFaqItems('riders', 'private 6-character').map((item) => item.id)).toEqual(['rider-delivery-codes'])
  })

  it('keeps results within the selected audience tab', () => {
    for (const role of FAQ_ROLES) {
      expect(filterFaqItems(role, '').every((item) => item.role === role)).toBe(true)
    }
    expect(filterFaqItems('customers', 'withdraw')).toHaveLength(0)
    expect(filterFaqItems('riders', 'withdraw').map((item) => item.id)).toEqual(['rider-withdrawals'])
  })
})

describe('FAQ accordion and keyboard model', () => {
  it('allows only one expanded item and collapses the selected item', () => {
    expect(toggleFaqItem(null, 'delivery')).toBe('delivery')
    expect(toggleFaqItem('delivery', 'payments')).toBe('payments')
    expect(toggleFaqItem('payments', 'payments')).toBeNull()
  })

  it('supports wrapping arrow keys plus Home and End for tabs and accordion headers', () => {
    expect(getKeyboardNavigationIndex(2, 'ArrowRight', 3, 'horizontal')).toBe(0)
    expect(getKeyboardNavigationIndex(0, 'ArrowLeft', 3, 'horizontal')).toBe(2)
    expect(getKeyboardNavigationIndex(3, 'ArrowDown', 8, 'vertical')).toBe(4)
    expect(getKeyboardNavigationIndex(0, 'ArrowUp', 8, 'vertical')).toBe(7)
    expect(getKeyboardNavigationIndex(4, 'Home', 8, 'vertical')).toBe(0)
    expect(getKeyboardNavigationIndex(4, 'End', 8, 'vertical')).toBe(7)
    expect(getKeyboardNavigationIndex(1, 'Enter', 3, 'horizontal')).toBeNull()
  })
})

describe('FAQ deep links', () => {
  it('resolves customer examples and switches to the owning role for partner links', () => {
    expect(findFaqByHash('#delivery')).toMatchObject({ id: 'delivery', role: 'customers' })
    expect(findFaqByHash('#payments')).toMatchObject({ id: 'payments', role: 'customers' })
    expect(findFaqByHash('#vendor-payouts')).toMatchObject({ role: 'vendors' })
    expect(findFaqByHash('#rider-delivery-codes')).toMatchObject({ role: 'riders' })
    expect(findFaqByHash('#not-a-real-topic')).toBeUndefined()
  })

  it('gives every item a unique, URL-safe id', () => {
    const ids = FAQ_ITEMS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true)
  })
})

describe('FAQ JSON-LD', () => {
  it('contains exactly the currently visible questions and their displayed answers', () => {
    const visible = filterFaqItems('customers', 'paystack')
    const schema = buildFaqJsonLd(visible)
    expect(schema?.['@type']).toBe('FAQPage')
    expect(schema?.mainEntity).toHaveLength(visible.length)
    expect(schema?.mainEntity.map((entity) => entity.name)).toEqual(visible.map((item) => item.question))
    expect(schema?.mainEntity.map((entity) => entity.acceptedAnswer.text)).toEqual(visible.map((item) => item.answer))
  })

  it('omits FAQPage schema when the visible result is empty', () => {
    expect(buildFaqJsonLd([])).toBeNull()
  })
})

describe('FAQ accessibility and responsive guardrails', () => {
  const component = readFileSync(join(process.cwd(), 'components/faq/faq-explorer.tsx'), 'utf8')
  const css = readFileSync(join(process.cwd(), 'components/faq/faq.module.css'), 'utf8')

  it('wires tabs, accordion state, regions, focusable controls, and result announcements', () => {
    expect(component).toContain('role="tablist"')
    expect(component).toContain('role="tabpanel"')
    expect(component).toContain('aria-selected={role === tabRole}')
    expect(component).toContain('aria-expanded={open}')
    expect(component).toContain('aria-controls={panelId}')
    expect(component).toContain('aria-labelledby={triggerId}')
    expect(component).toContain('aria-live="polite"')
    expect(component).toContain("trigger.focus({ preventScroll: true })")
  })

  it('is mobile-first and disables non-essential motion when requested', () => {
    expect(css).toContain('@media (min-width: 480px)')
    expect(css).toContain('@media (min-width: 720px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('transition-duration: 0.001ms !important')
  })
})
