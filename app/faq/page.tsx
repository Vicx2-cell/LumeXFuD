import type { Metadata } from 'next'
import { FaqExplorer } from '@/components/faq/faq-explorer'
import { SiteFooter } from '@/components/site-footer'
import { seoUrl } from '@/lib/seo/config'

const title = 'Help Center & FAQs'
const description = 'Answers for LumeX Fud customers, vendors, and riders — from orders and delivery to menus, earnings, payouts, and support.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/faq' },
  openGraph: {
    type: 'website',
    url: seoUrl('/faq'),
    siteName: 'LumeX Fud',
    title: `${title} · LumeX Fud`,
    description,
    images: [{ url: '/icons/icon-512-v2.png', width: 512, height: 512, alt: 'LumeX Fud' }],
  },
  twitter: { card: 'summary', title: `${title} · LumeX Fud`, description },
}

export default function FaqPage() {
  return (
    <>
      <FaqExplorer />
      <SiteFooter />
    </>
  )
}
