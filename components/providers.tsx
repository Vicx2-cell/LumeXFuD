'use client'

import { type ReactNode } from 'react'
import { CartProvider } from './cart-context'
import { PWA } from './pwa'
import { Announcement } from './announcement'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      {children}
      <PWA />
      <Announcement />
    </CartProvider>
  )
}
