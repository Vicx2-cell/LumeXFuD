// ─── Order prep-time estimate ────────────────────────────────────────────────
// Vendors set a prep time per dish (menu_items.prep_time_minutes); an item left
// blank inherits the vendor's base time. An order's estimate is the LONGEST dish
// in it — a kitchen cooks items in parallel, so the slowest dish gates the order
// (not the sum). Pure + DB-free so it's unit-testable and identical everywhere.

export interface PrepItem {
  /** Per-item prep minutes, or null to fall back to the vendor base. */
  prepTimeMinutes: number | null
}

/** Clamp to the same 1..180 range the DB enforces, rounded to a whole minute. */
function clampPrep(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(180, Math.round(n)))
}

/**
 * Estimated prep minutes for an order: the longest dish, with each blank item
 * falling back to the vendor base. Empty cart → the vendor base.
 */
export function estimateOrderPrepMinutes(items: ReadonlyArray<PrepItem>, vendorBaseMinutes: number): number {
  const base = clampPrep(vendorBaseMinutes)
  if (items.length === 0) return base
  let longest = 0
  for (const it of items) {
    const t = it.prepTimeMinutes == null ? base : clampPrep(it.prepTimeMinutes)
    if (t > longest) longest = t
  }
  return longest
}

/**
 * Customer-facing window: prep + a ~10-min transit allowance, shown as a range.
 * e.g. 20 → "20–30 min". Mirrors the existing vendor-page range style.
 */
export function prepRangeLabel(prepMinutes: number, transitMinutes = 10): string {
  const lo = clampPrep(prepMinutes)
  return `${lo}–${lo + transitMinutes} min`
}
