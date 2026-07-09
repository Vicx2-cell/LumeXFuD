'use client'

import { type ReactNode } from 'react'
import { CartProvider } from './cart-context'
import { PWA } from './pwa'
import { Announcement } from './announcement'
import { BrandSplash } from './brand-splash'
import { ThemeProvider } from './theme-provider'
import { AutoRefresh } from './auto-refresh'

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
