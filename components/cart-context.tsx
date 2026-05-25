'use client'

import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'

export interface CartItem {
  id: string
  name: string
  price_kobo: number
  quantity: number
  special_instructions?: string
}

export interface CartState {
  vendor_id: string | null
  vendor_name: string | null
  items: CartItem[]
}

type CartAction =
  | { type: 'ADD_ITEM'; vendor_id: string; vendor_name: string; item: CartItem }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'SET_QUANTITY'; id: string; quantity: number }
  | { type: 'CLEAR' }
  | { type: 'HYDRATE'; state: CartState }

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state

    case 'ADD_ITEM': {
      if (state.vendor_id && state.vendor_id !== action.vendor_id) {
        return state // caller must confirm vendor switch before clearing
      }
      const existing = state.items.find((i) => i.id === action.item.id)
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === action.item.id
              ? { ...i, quantity: Math.min(i.quantity + 1, 20) }
              : i
          ),
        }
      }
      return {
        vendor_id: action.vendor_id,
        vendor_name: action.vendor_name,
        items: [...state.items, { ...action.item, quantity: 1 }],
      }
    }

    case 'REMOVE_ITEM': {
      const items = state.items.filter((i) => i.id !== action.id)
      return items.length === 0
        ? { vendor_id: null, vendor_name: null, items: [] }
        : { ...state, items }
    }

    case 'SET_QUANTITY': {
      if (action.quantity <= 0) {
        const items = state.items.filter((i) => i.id !== action.id)
        return items.length === 0
          ? { vendor_id: null, vendor_name: null, items: [] }
          : { ...state, items }
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id ? { ...i, quantity: Math.min(action.quantity, 20) } : i
        ),
      }
    }

    case 'CLEAR':
      return { vendor_id: null, vendor_name: null, items: [] }

    default:
      return state
  }
}

const STORAGE_KEY = 'lumex_cart'

const initialState: CartState = { vendor_id: null, vendor_name: null, items: [] }

interface CartContextValue {
  cart: CartState
  addItem: (vendor_id: string, vendor_name: string, item: CartItem) => boolean
  removeItem: (id: string) => void
  setQuantity: (id: string, quantity: number) => void
  clearCart: () => void
  totalItems: number
  subtotal: number
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, dispatch] = useReducer(cartReducer, initialState)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as CartState
        dispatch({ type: 'HYDRATE', state: parsed })
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
  }, [cart])

  function addItem(vendor_id: string, vendor_name: string, item: CartItem): boolean {
    if (cart.vendor_id && cart.vendor_id !== vendor_id) {
      return false // signals caller to show confirm dialog
    }
    dispatch({ type: 'ADD_ITEM', vendor_id, vendor_name, item })
    return true
  }

  function removeItem(id: string) {
    dispatch({ type: 'REMOVE_ITEM', id })
  }

  function setQuantity(id: string, quantity: number) {
    dispatch({ type: 'SET_QUANTITY', id, quantity })
  }

  function clearCart() {
    dispatch({ type: 'CLEAR' })
  }

  const totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0)
  const subtotal = cart.items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)

  return (
    <CartContext.Provider value={{ cart, addItem, removeItem, setQuantity, clearCart, totalItems, subtotal }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
