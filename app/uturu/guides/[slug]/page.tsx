import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/money'
import { Breadcrumbs } from '@/components/seo/breadcrumbs'
import { FaqList } from '@/components/seo/faq-list'
import { PLACE, seoUrl } from '@/lib/seo/config'
import { getGuide, guidePath } from '@/lib/seo/guides'
import { buildGuideJsonLd } from '@/lib/seo/jsonld'
import { buildGuide } from './guide-content'

// Dynamic SSR (zero client JS) — same rationale as the vendor page: the app's
// root layout is force-dynamic, so a force-static page fails at on-demand
// generation. These pages stay light and fully crawlable, and guide content can
// be gated to live flags/data per request.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const g = getGuide(slug)
  if (!g) return { title: 'Guide not found', robots: { index: false, follow: false } }
  const canonical = guidePath(g.slug)
  return {
    title: { absolute: `${g.title} · LumeX Fud` },
    description: g.description,
    alternates: { canonical },
    openGraph: {
      type: 'article', url: seoUrl(canonical), siteName: 'LumeX Fud',
      title: g.title, description: g.description,
      images: [{ url: '/icons/icon-512-v2.png', alt: 'LumeX Fud' }],
    },
    twitter: { card: 'summary', title: g.title, description: g.description },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const g = getGuide(slug)
  if (!g) notFound()

  const built = await buildGuide(slug)
  if (!built) notFound()

  const jsonLd = buildGuideJsonLd({
    slug: g.slug, title: g.title, description: g.description, updated: g.updated, faq: built.faq,
  })

  return (
    <article className="max-w-3xl mx-auto px-5 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Breadcrumbs items={[
        { name: 'Home', href: '/' },
        // 'Guides' index (part of T4 hub) not built yet → plain text, no 404.
        { name: 'Guides' },
        { name: g.title },
      ]} />

      <header className="mb-6">
        <span className="lx-eyebrow lx-amber">Guide · {PLACE.town}, ABSU</span>
        <h1 className="lx-display text-2xl sm:text-3xl font-bold leading-tight mt-3">{g.title}</h1>
        <p className="text-white/55 text-sm mt-2 leading-relaxed">{g.description}</p>
      </header>

      <div>{built.lead}</div>

      <FaqList items={built.faq} />

      {built.related.length > 0 && (
        <section className="mt-10">
          <h2 className="lx-display text-base font-bold mb-3">Related guides</h2>
          <div className="flex flex-col gap-2">
            {built.related.map((r) => (
              <Link key={r.href} href={r.href} className="glass-thin rounded-xl p-3 text-sm text-white/80 hover:text-white transition-colors flex items-center justify-between">
                {r.label}
                <span aria-hidden="true" className="lx-amber">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 glass-thick p-6 text-center space-y-3 rounded-2xl">
        <h2 className="lx-display text-lg font-bold">Ready to order?</h2>
        <p className="text-sm text-white/60">Browse real campus menus with honest all-in prices on LumeX.</p>
        <Link href="/home" className="lx-btn-amber inline-flex items-center justify-center px-8 py-3.5 text-base" style={{ minHeight: 52, borderRadius: 14 }}>
          Open LumeX
        </Link>
      </div>

      <p className="mt-6 text-center text-xs text-white/35">
        Last updated {formatDate(g.updated)} · {PLACE.areaLine}
      </p>
    </article>
  )
}
