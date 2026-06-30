import { SeoHeader } from '@/components/seo/seo-header'
import { SiteFooter } from '@/components/site-footer'

// Public "Uturu Food Graph" content pages — server-rendered, crawlable, and
// light (no client JS, fast on 2G/EDGE). We deliberately do NOT mount the
// logged-in BottomNav or the FeaturesProvider-driven app chrome here; this is a
// content surface, with one job: inform, then convert via a single "Order on
// LumeX" CTA. (Pages render dynamically — see the note in the page file on why
// static/ISR needs a separate route-group carve-out.)

export default function UturuLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lx-page flex flex-col min-h-screen text-white">
      <SeoHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}
