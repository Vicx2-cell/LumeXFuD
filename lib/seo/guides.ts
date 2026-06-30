// T5 — guide / FAQ pages (/uturu/guides/[slug]). These are gift-first: written to
// genuinely help a student near ABSU even if they never order. Metadata lives
// here (no React) so generateMetadata + sitemap can read it cheaply; the actual
// page body + FAQ Q&A are built per-request in guide-content.tsx so they can be
// gated to what is actually true (the `ordering` flag, live hours, real prices).

export interface FaqItem {
  question: string
  answer: string
}

export interface GuideDef {
  slug: string
  /** <h1> + <title> base. */
  title: string
  /** One-line meta description / page lead summary. */
  description: string
  /** Last content review date (Africa/Lagos), shown as the trust stamp. Bump
   *  this whenever the prose is meaningfully edited. */
  updated: string // 'YYYY-MM-DD'
}

// Keep slugs EXACTLY as the founder specified.
export const GUIDES: GuideDef[] = [
  {
    slug: 'how-to-spot-food-vendor-scams-uturu',
    title: 'How to spot food-vendor scams in Uturu (ABSU)',
    description:
      'A practical, local guide for ABSU students: how to avoid getting scammed when you order food in Uturu — the red flags, the safe way to pay, and what to do if an order goes wrong.',
    updated: '2026-06-30',
  },
  {
    slug: 'whats-open-late-near-absu',
    title: "What's open late near ABSU",
    description:
      'Where to find late-night food around Abia State University, Uturu — which campus vendors stay open late, the platform hours, and how to order when the kitchens are still on.',
    updated: '2026-06-30',
  },
  {
    slug: 'how-escrow-protects-you-on-lumexfud',
    title: 'How escrow protects you on LumeX Fud',
    description:
      'Plain-language explainer of how your money is protected when you order on LumeX Fud — you pay the platform, not the vendor directly, and the money is only released after your food arrives.',
    updated: '2026-06-30',
  },
  {
    slug: 'eating-well-on-a-budget-near-absu',
    title: 'Eating well on a budget near ABSU',
    description:
      'Honest, practical tips for ABSU students on stretching a small daily food budget in Uturu — how to spend less per meal, split delivery, and still eat enough good food.',
    updated: '2026-06-30',
  },
]

export function getGuide(slug: string): GuideDef | undefined {
  return GUIDES.find((g) => g.slug === slug)
}

export function listGuides(): GuideDef[] {
  return GUIDES
}

export const guidePath = (slug: string) => `/uturu/guides/${slug}`
