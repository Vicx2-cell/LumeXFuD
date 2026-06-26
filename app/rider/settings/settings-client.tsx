'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ProfileImageUpload } from '@/components/profile-image-upload'
import { FaceIdSetup } from '@/components/face-id-setup'
import { KycPanel } from '@/components/kyc-panel'
import { ConfirmSheet } from '@/components/ui/confirm-sheet'
import { Wallet, Star, ChevronRight } from 'lucide-react'
import type { RiderSettable } from './page'

const LINKS = [
  { href: '/rider/wallet',  Icon: Wallet, label: 'Wallet & payout', desc: 'Balance, withdrawals & bank account' },
  { href: '/rider/reviews', Icon: Star,   label: 'Reviews',         desc: 'Private feedback from your deliveries' },
]

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <p className="lx-mono mb-3 px-1">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function RiderSettings({ rider: r0 }: { rider: RiderSettable }) {
  const [rider, setRider] = useState(r0)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function handleLogout() {
    setSigningOut(true)
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* still navigate */ }
    window.location.href = '/'
  }

  return (
    <div className="mt-1 lx-enter">
      {/* Identity strip — editable avatar */}
      <div className="flex items-center gap-3 mb-7">
        <ProfileImageUpload
          slot="avatar" shape="circle" size={52} current={rider.avatar_url}
          onUploaded={(u) => setRider((x) => ({ ...x, avatar_url: u }))}
        />
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{rider.full_name}</p>
          <p className="lx-mono mt-0.5 lx-nums">
            {rider.total_deliveries} deliveries · {rider.avg_rating?.toFixed(1) ?? '—'}★
          </p>
        </div>
      </div>

      {/* ── MONEY ── */}
      <Group title="Money & reviews">
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

      {/* ── VERIFICATION ── */}
      <Group title="Verification">
        <KycPanel role="rider" />
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
