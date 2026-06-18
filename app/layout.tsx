import type { Metadata, Viewport } from 'next'
import './globals.css'
import { validateEnv } from '@/lib/env'
import { Providers } from '@/components/providers'
import { FeaturesProvider } from '@/lib/use-features'
import { getAllFeatures } from '@/lib/features'

if (process.env.NODE_ENV !== 'test') validateEnv()

// Feature flags are resolved per request in the layout below, so pages must not
// be statically prerendered with build-time flag values. This makes the app
// render on demand — disabled features never reach the browser, and a toggle
// takes effect on the next navigation/reload.
export const dynamic = 'force-dynamic'

const SITE_URL = 'https://lumexfud.com.ng'
const SITE_DESC =
  'LumeX Fud is campus food delivery for Abia State University (ABSU), Uturu. Order from your favourite campus restaurants and get it delivered to your hostel — fast delivery, live tracking, and secure digital payment.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'LumeX Fud',
  title: {
    default: 'LumeX Fud — Campus food delivery at ABSU',
    template: '%s · LumeX Fud',
  },
  description: SITE_DESC,
  keywords: [
    'LumeX', 'LumeX Fud', 'lumexfud', 'lumex food', 'lumex absu',
    'ABSU food delivery', 'Abia State University food', 'Uturu food delivery',
    'campus food delivery Nigeria', 'order food ABSU', 'student food delivery',
  ],
  manifest: '/manifest.json',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'LumeX Fud',
    locale: 'en_NG',
    url: SITE_URL,
    title: 'LumeX Fud — Campus life, simplified.',
    description: SITE_DESC,
    images: [{ url: '/icons/icon-512-v2.png', width: 512, height: 512, alt: 'LumeX Fud' }],
  },
  twitter: {
    card: 'summary',
    title: 'LumeX Fud — Campus life, simplified.',
    description: SITE_DESC,
    images: ['/icons/icon-512-v2.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LumeX Fud',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192-v2.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512-v2.png', sizes: '512x512', type: 'image/png' },
    ],
    // Clean URL, no query string: iOS Safari often fails to load an
    // apple-touch-icon with a query and then shows a black page-screenshot
    // instead. Served from the root, where iOS also looks by convention.
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0A0A0B',
  // The on-screen keyboard resizes the layout viewport instead of overlaying it,
  // so bottom-anchored inputs (e.g. the Lumi chat) stay visible while typing.
  interactiveWidget: 'resizes-content',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve feature flags on the server so disabled features are never rendered
  // into the HTML (no client-side "appear then disappear" flash). getAllFeatures
  // is ~20s cached and fails safe to catalog defaults, so this is one cheap read
  // per request. Reading it here makes pages render per-request (dynamic).
  const features = await getAllFeatures()
  return (
    <html lang="en">
      <body>
        <FeaturesProvider initial={features}>
          <Providers>{children}</Providers>
        </FeaturesProvider>
      </body>
    </html>
  )
}
