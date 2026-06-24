'use client'

import { type ReactNode } from 'react'
import { CartProvider } from './cart-context'
import { PWA } from './pwa'
import { Announcement } from './announcement'
import { BrandSplash } from './brand-splash'
import { ThemeProvider } from './theme-provider'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <CartProvider>
        {children}
        <PWA />
        <Announcement />
        <BrandSplash />
      </CartProvider>
    </ThemeProvider>
  )
}
