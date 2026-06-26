'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ProfileImageUpload } from '@/components/profile-image-upload'
import { BusinessHours } from '@/components/business-hours'
import { FaceIdSetup } from '@/components/face-id-setup'
import { ConfirmSheet } from '@/components/ui/confirm-sheet'
import { UtensilsCrossed, Wallet, Star, Share2, ChevronRight } from 'lucide-react'
import type { VendorSettable } from './page'

const LINKS = [
  { href: '/vendor-dashboard/menu',     Icon: UtensilsCrossed, label: 'Menu & items',     desc: 'Add, edit and price your food' },
  { href: '/vendor-dashboard/earnings', Icon: Wallet,          label: 'Earnings & payout', desc: 'Balance, withdrawals & bank account' },
  { href: '/vendor-dashboard/reviews',  Icon: Star,            label: 'Reviews',           desc: 'See what customers are saying' },
  { href: '/vendor-dashboard/share',    Icon: Share2,          label: 'Share your store',   desc: 'Your link & ready-made captions' },
]

/** A settings group: a mono section label over a tight cluster of cards, with a
 *  generous gap to the next group (the iOS/Stripe grouped-settings rhythm). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <p className="lx-mono mb-3 px-1">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function VendorSettings({ vendor: v0 }: { vendor: VendorSettable }) {
  const [vendor, setVendor] = useState(v0)
  const [cap, setCap] = useState(String(vendor.pickup_max_concurrent ?? 0))
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const pickupOn = vendor.pickup_enabled !== false

  async function savePickup(patch: { pickup_enabled?: boolean; pickup_max_concurrent?: number }) {
    setVendor((x) => ({ ...x, ...patch })) // optimistic
    await fetch(`/api/vendors/${vendor.id}/pickup-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async function handleLogout() {
    setSigningOut(true)
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* still navigate */ }
    window.location.href = '/'
  }

  return (
    <div className="mt-1 lx-enter">
      {/* Identity strip */}
      <div className="flex items-center gap-3 mb-7">
        <span className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-white/5 border border-white/10">
          {vendor.logo_url
            ? <Image src={vendor.logo_url} alt="" fill className="object-cover" sizes="48px" />
            : <span className="w-full h-full flex items-center justify-center text-lg opacity-40">🏪</span>}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{vendor.shop_name}</p>
          <p className="lx-mono mt-0.5">Vendor account</p>
        </div>
      </div>

      {/* ── STORE ── */}
      <Group title="Store">
        <div className="lx-surface p-4 space-y-3">
          <p className="text-xs text-white/45">Cover &amp; logo customers see</p>
          <ProfileImageUpload
            slot="cover" shape="cover" current={vendor.shop_photo_url} deletable
            onUploaded={(u) => setVendor((x) => ({ ...x, shop_photo_url: u }))}
            onRemoved={() => setVendor((x) => ({ ...x, shop_photo_url: null }))}
            label="Cover photo — customers see this on your store"
          />
          <div className="flex items-center gap-3 pt-1">
            <ProfileImageUpload
              slot="avatar" shape="circle" current={vendor.logo_url}
              onUploaded={(u) => setVendor((x) => ({ ...x, logo_url: u }))}
            />
            <div>
              <p className="text-sm font-medium text-white/80">Store logo</p>
              <p className="text-xs text-white/40">Required</p>
            </div>
          </div>
        </div>

        <BusinessHours id={vendor.id} initialOpen={vendor.opening_time} initialClose={vendor.closing_time} />

        {/* Pickup (Order Ahead) */}
        <div className="lx-surface p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/80 flex items-center gap-1.5">🛍️ Pickup (Order Ahead)</p>
              <p className="text-xs text-white/45 mt-0.5">Let customers order ahead and collect — no rider, ₦0 delivery.</p>
            </div>
            <button
              type="button" role="switch" aria-checked={pickupOn}
              onClick={() => savePickup({ pickup_enabled: !pickupOn })}
              className="relative w-12 h-7 rounded-full transition-colors shrink-0"
              style={{ background: pickupOn ? '#F5A623' : 'rgba(255,255,255,0.15)' }}
            >
              <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: pickupOn ? 26 : 4 }} />
            </button>
          </div>
          {pickupOn && (
            <div className="lx-enter">
              <label className="text-xs text-white/50 block mb-1">Max pickup orders at once (pacing)</label>
              <div className="flex gap-2">
                <input
                  type="number" min={0} max={100} inputMode="numeric" value={cap}
                  onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  className="lx-field flex-1 min-w-0 px-3 py-2.5 text-base outline-none tabular-nums"
                />
                <button
                  onClick={() => savePickup({ pickup_max_concurrent: Math.max(0, Math.min(100, Number(cap) || 0)) })}
                  className="lx-btn-amber lx-tap px-4 min-h-[44px] text-xs shrink-0"
                >Save</button>
              </div>
              <p className="text-xs text-white/35 mt-1.5">0 = no limit. Above the cap, new orders get a later “ready by” time instead of stacking.</p>
            </div>
          )}
        </div>
      </Group>

      {/* ── MANAGE ── */}
      <Group title="Manage">
        <div className="lx-surface overflow-hidden">
          {LINKS.map((l, i) => (
            <Link
              key={l.href} href={l.href}
              className={`flex items-center gap-3 p-4 lx-tap${i > 0 ? ' border-t border-white/[0.06]' : ''}`}
            >
              <span className="w-9 h-9 rounded-xl grid place-items-center text-white/55 shrink-0" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lx-border)' }}>
                <l.Icon size={18} strokeWidth={1.75} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90">{l.label}</p>
                <p className="text-xs text-white/40">{l.desc}</p>
              </div>
              <ChevronRight size={16} strokeWidth={2} className="text-white/30 shrink-0" />
            </Link>
          ))}
        </div>
      </Group>

      {/* ── ACCOUNT ── */}
      <Group title="Account">
        <div className="lx-surface p-4 space-y-3">
          <p className="text-xs text-white/45">Sign-in & security</p>
          <FaceIdSetup />
        </div>
        <button
          onClick={() => setSignOutOpen(true)}
          className="w-full rounded-xl py-3.5 text-sm font-semibold transition-colors active:scale-[0.99]"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.18)' }}
        >
          Sign out
        </button>
      </Group>

      <ConfirmSheet
        open={signOutOpen}
        title="Sign out?"
        body="You'll need your PIN (or a one-time code) to sign back in."
        confirmLabel="Sign out"
        loadingLabel="Signing out…"
        loading={signingOut}
        onConfirm={handleLogout}
        onCancel={() => setSignOutOpen(false)}
      />
    </div>
  )
}
