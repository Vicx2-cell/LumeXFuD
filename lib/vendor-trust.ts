// Honest, data-driven trust signals for a vendor — derived purely from numbers
// the platform already tracks (ratings + prep time). No new storage, no money.
// Used on the homepage cards and the vendor page so a customer can see *why* a
// vendor is worth ordering from (which is what the platform fee quietly buys).

export interface VendorTrustInput {
  avg_rating: number
  total_ratings: number
  prep_time_minutes: number
}

export interface TrustBadge {
  emoji: string
  label: string
}

// Returns at most TWO badges, highest-signal first, so cards stay uncluttered.
// Thresholds are intentionally conservative — a badge only shows when the data
// genuinely earns it (no badge for brand-new vendors with thin samples).
export function vendorTrustBadges(v: VendorTrustInput): TrustBadge[] {
  const out: TrustBadge[] = []

  if (v.total_ratings >= 10 && v.avg_rating >= 4.5) {
    out.push({ emoji: '⭐', label: 'Top rated' })
  }

  if (v.total_ratings >= 50) {
    out.push({ emoji: '🔥', label: 'Popular' })
  } else if (v.total_ratings >= 20 && v.avg_rating >= 4.0) {
    out.push({ emoji: '✓', label: 'Trusted' })
  }

  if (v.prep_time_minutes > 0 && v.prep_time_minutes <= 20) {
    out.push({ emoji: '⚡', label: 'Fast' })
  }

  return out.slice(0, 2)
}
