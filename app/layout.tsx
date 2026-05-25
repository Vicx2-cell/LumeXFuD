import type { Metadata, Viewport } from 'next'
import './globals.css'
import { validateEnv } from '@/lib/env'
import { Providers } from '@/components/providers'

if (process.env.NODE_ENV !== 'test') validateEnv()

export const metadata: Metadata = {
  title: 'LumeX Fud — Campus life, simplified.',
  description: 'Campus food delivery for Abia State University. Order from vendors on campus, delivered to your hostel.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LumeX Fud',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#F5A623',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
