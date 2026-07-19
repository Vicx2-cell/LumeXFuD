'use client'

import dynamic from 'next/dynamic'
import { type ReactNode } from 'react'
import { CartProvider } from './cart-context'
import { BrandSplash } from './brand-splash'
import { ThemeProvider } from './theme-provider'
import { AutoRefresh } from './auto-refresh'

const PWA = dynamic(() => import('./pwa').then((mod) => mod.PWA), { ssr: false })
const Announcement = dynamic(() => import('./announcement').then((mod) => mod.Announcement), { ssr: false })

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <CartProvider>
        {children}
        <AutoRefresh />
        <PWA />
        <Announcement />
        <BrandSplash />
      </CartProvider>
    </ThemeProvider>
  )
}
