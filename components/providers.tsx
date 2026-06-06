'use client'

import { type ReactNode } from 'react'
import { CartProvider } from './cart-context'
import { PWA } from './pwa'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      {children}
      <PWA />
    </CartProvider>
  )
}
