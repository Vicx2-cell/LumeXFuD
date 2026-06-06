'use client'

import { useRouter } from 'next/navigation'

// Small, consistent back affordance. Goes back in history when possible,
// otherwise falls back to a sensible route (so it never dead-ends).
export function BackButton({ fallback = '/' }: { fallback?: string }) {
  const router = useRouter()
  return (
    <button
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back()
        else router.push(fallback)
      }}
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
      style={{ background: 'rgba(255,255,255,0.06)' }}
      aria-label="Go back"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  )
}
