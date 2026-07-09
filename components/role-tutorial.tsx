'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { ArrowRight, ChevronLeft, ChevronRight, CircleHelp, X } from 'lucide-react'

type TutorialRole = 'customer' | 'vendor' | 'rider'
type TutorialVariant = 'icon' | 'button'

type TutorialShot = {
  title: string
  description: string
  screenshot: string
  alt: string
}

type TutorialData = {
  title: string
  intro: string
  primary: string
  shots: TutorialShot[]
}

const TUTORIALS: Record<TutorialRole, TutorialData> = {
  customer: {
    title: 'Customer guide',
    intro: 'A clean screenshot walk-through of ordering, pinning your location, and checking out without surprises.',
    primary: 'Show customer guide',
    shots: [
      {
        title: 'Home feed',
        description: 'Browse vendors in your zone and open the shop you want.',
        screenshot: '/tutorial-screens/live/1-home.png',
        alt: 'Customer home screen with vendors',
      },
      {
        title: 'Cart review',
        description: 'Confirm your items and quantities before payment.',
        screenshot: '/tutorial-screens/live/4-cart.png',
        alt: 'Customer cart screen with items and totals',
      },
      {
        title: 'Checkout',
        description: 'See the fee breakdown and total before you pay.',
        screenshot: '/tutorial-screens/live/5-checkout.png',
        alt: 'Checkout screen with price breakdown',
      },
    ],
  },
  vendor: {
    title: 'Vendor guide',
    intro: 'A clean screenshot walk-through of live orders, preparation, and handoff.',
    primary: 'Show vendor guide',
    shots: [
      {
        title: 'Live board',
        description: 'Open the dashboard and see incoming orders at a glance.',
        screenshot: '/tutorial-screens/live/2-vendor.png',
        alt: 'Vendor dashboard with live orders',
      },
      {
        title: 'Order progress',
        description: 'Move orders through preparing and ready, clearly and quickly.',
        screenshot: '/tutorial-screens/live/3-vendor-after-add.png',
        alt: 'Vendor dashboard after adding items to an order',
      },
      {
        title: 'Pickup finish',
        description: 'Complete pickup only when the order is truly collected.',
        screenshot: '/tutorial-screens/after/vendor_afe17dbd-1abf-476f-a5cf-06e3e8f3a5ae.png',
        alt: 'Vendor order screen showing a completed handoff',
      },
    ],
  },
  rider: {
    title: 'Rider guide',
    intro: 'A clean screenshot walk-through of going online, picking up, and finishing deliveries safely.',
    primary: 'Show rider guide',
    shots: [
      {
        title: 'Sign in',
        description: 'Get into the rider flow and go online when ready.',
        screenshot: '/tutorial-screens/after/auth.png',
        alt: 'Login screen used to enter the rider app',
      },
      {
        title: 'Pickup step',
        description: 'Accept only assigned jobs and confirm pickup after collection.',
        screenshot: '/tutorial-screens/after/auth-pin-partial.png',
        alt: 'Authentication step shown on mobile',
      },
      {
        title: 'Drop-off finish',
        description: 'Navigate to the customer, confirm handoff, and complete the delivery.',
        screenshot: '/tutorial-screens/live/5-checkout.png',
        alt: 'Order flow screen used as a delivery reference',
      },
    ],
  },
}

interface RoleTutorialProps {
  role: TutorialRole
  variant?: TutorialVariant
  className?: string
}

function TutorialImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative aspect-[9/16] overflow-hidden rounded-[24px] border border-white/10 bg-[#0d0d0f]">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 100vw, 420px"
        className="object-contain"
        unoptimized
      />
    </div>
  )
}

export function RoleTutorial({ role, variant = 'icon', className }: RoleTutorialProps) {
  const tutorial = useMemo(() => TUTORIALS[role], [role])
  const storageKey = `lx_tutorial_seen_${role}`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const close = useCallback(() => {
    setOpen(false)
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {}
  }, [storageKey])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setActive((i) => Math.min(tutorial.shots.length - 1, i + 1))
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, close, tutorial.shots.length])

  const activeIndex = Math.min(active, tutorial.shots.length - 1)
  const current = tutorial.shots[activeIndex] ?? tutorial.shots[0]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        aria-label={tutorial.primary}
        title={tutorial.primary}
      >
        {variant === 'icon' ? (
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
            <CircleHelp size={18} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white">
            <CircleHelp size={16} />
            {tutorial.primary}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 px-0 sm:items-center sm:px-4"
          style={{ backdropFilter: 'blur(6px)' }}
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tutorial.title}
            className="w-full sm:max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="rounded-t-3xl border border-white/10 px-4 py-4 sm:rounded-3xl sm:px-5 sm:py-5"
              style={{
                background: 'var(--lx-surface-solid)',
                boxShadow: '0 -18px 48px rgba(0,0,0,0.42)',
              }}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden="true" />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">Tutorial</p>
                  <h3 className="mt-1 text-lg font-semibold text-white sm:text-xl">{tutorial.title}</h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">{tutorial.intro}</p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:text-white"
                  aria-label="Close tutorial"
                >
                  <X size={16} strokeWidth={2.2} />
                </button>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="space-y-3">
                  <TutorialImage src={current.screenshot} alt={current.alt} />
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{current.title}</p>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-black"
                        style={{ background: 'var(--color-amber)' }}
                      >
                        {activeIndex + 1}/{tutorial.shots.length}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-white/60">{current.description}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {tutorial.shots.map((shot, index) => {
                    const selected = index === activeIndex
                    return (
                      <button
                        key={shot.title}
                        type="button"
                        onClick={() => setActive(index)}
                        className="w-full rounded-2xl border p-2.5 text-left transition-colors"
                        style={{
                          borderColor: selected ? 'rgba(245,166,35,0.38)' : 'rgba(255,255,255,0.08)',
                          background: selected ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.03)',
                        }}
                        aria-pressed={selected}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-16 shrink-0 sm:w-20">
                            <TutorialImage src={shot.screenshot} alt={shot.alt} />
                          </div>
                          <div className="min-w-0 flex-1 py-0.5">
                            <p className="text-sm font-semibold text-white">{index + 1}. {shot.title}</p>
                            <p className="mt-1 text-xs leading-relaxed text-white/55">{shot.description}</p>
                          </div>
                          <span className="shrink-0 pt-1 text-white/35">
                            {selected ? (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ background: 'var(--color-amber)' }}
                              />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setActive((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 disabled:opacity-35"
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>

                <div className="flex items-center gap-1.5">
                  {tutorial.shots.map((shot, index) => (
                    <button
                      key={shot.title}
                      type="button"
                      onClick={() => setActive(index)}
                      className="h-2.5 rounded-full transition-all"
                      style={{
                        width: index === activeIndex ? 18 : 8,
                        background: index === activeIndex ? 'var(--color-amber)' : 'rgba(255,255,255,0.22)',
                      }}
                      aria-label={`Show step ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setActive((i) => Math.min(tutorial.shots.length - 1, i + 1))}
                  disabled={activeIndex >= tutorial.shots.length - 1}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-black disabled:opacity-35"
                  style={{ background: 'var(--color-amber)' }}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-black"
                  style={{ background: 'var(--color-amber)' }}
                >
                  Got it
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
