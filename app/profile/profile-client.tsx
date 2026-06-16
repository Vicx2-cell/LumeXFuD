'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'
import { FaceIdSetup } from '@/components/face-id-setup'
import { LumiMemoryCard } from '@/components/lumi-memory-card'
import type { CustomerProfile, StreakData, BadgeItem } from './page'

const KEYPAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'] as const

function PinIndicators({ value }: { value: string }) {
  return (
    <div className="flex gap-3 justify-center my-4">
      {[0,1,2,3,4,5].map((i) => (
        <div
          key={i}
          className="w-4 h-4 rounded-full transition-all"
          style={{
            background: value.length > i ? '#F5A623' : 'rgba(255,255,255,0.15)',
            border: `2px solid ${value.length > i ? '#F5A623' : 'rgba(255,255,255,0.2)'}`,
          }}
        />
      ))}
    </div>
  )
}

function NumericKeypad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYPAD.map((key, i) => (
        key === '' ? (
          <div key={i} />
        ) : (
          <button
            key={i}
            onClick={() => onKey(key)}
            className="rounded-xl font-semibold text-lg flex items-center justify-center transition-opacity active:opacity-60"
            style={{
              background: key === '⌫' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)',
              color: '#fff',
              minHeight: 52,
            }}
          >
            {key}
          </button>
        )
      ))}
    </div>
  )
}

export function ProfileClient({
  profile,
  streak,
  badges,
  phone,
  supportPhone,
}: {
  profile: CustomerProfile | null
  streak: StreakData | null
  badges: BadgeItem[]
  phone: string
  supportPhone?: string
}) {
  const router = useRouter()
  const [name, setName] = useState(profile?.name ?? '')
  const [hostel, setHostel] = useState(profile?.hostel ?? '')
  const [room, setRoom] = useState(profile?.room_number ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [openBadge, setOpenBadge] = useState<string | null>(null)
  // Lumi's warm, AI-generated explanation of the tapped badge (cached server-side).
  // One result per badge; text === null means "fetched, but no Lumi line" (AI off
  // / error) → we just show the static description, no spinner stuck on.
  const [lumiResult, setLumiResult] = useState<{ id: string; text: string | null } | null>(null)

  useEffect(() => {
    if (!openBadge || lumiResult?.id === openBadge) return
    let alive = true
    fetch(`/api/lumi/badge?id=${encodeURIComponent(openBadge)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { text: string | null } | null) => {
        if (alive) setLumiResult({ id: openBadge, text: d?.text ?? null })
      })
      .catch(() => { if (alive) setLumiResult({ id: openBadge, text: null }) })
    return () => { alive = false }
  }, [openBadge, lumiResult?.id])

  // Security / PIN management
  type PinFlow = 'idle' | 'change-current' | 'change-new' | 'change-confirm' | 'remove'
  const [pinFlow, setPinFlow] = useState<PinFlow>('idle')
  const [pinCurrent, setPinCurrent] = useState('')
  const [pinNew, setPinNew] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinWorking, setPinWorking] = useState(false)
  const [pinSuccess, setPinSuccess] = useState('')

  function resetPinFlow() {
    setPinFlow('idle')
    setPinCurrent('')
    setPinNew('')
    setPinConfirm('')
    setPinError('')
    setPinSuccess('')
  }

  function handleChangePinKey(key: string) {
    const setter =
      pinFlow === 'change-current' ? setPinCurrent :
      pinFlow === 'change-new'     ? setPinNew     : setPinConfirm
    const value =
      pinFlow === 'change-current' ? pinCurrent :
      pinFlow === 'change-new'     ? pinNew     : pinConfirm

    if (key === '⌫') {
      setter(value.slice(0, -1))
      setPinError('')
      return
    }
    if (value.length >= 6) return
    const next = value + key
    setter(next)

    if (next.length === 6) {
      if (pinFlow === 'change-current') setPinFlow('change-new')
      else if (pinFlow === 'change-new') setPinFlow('change-confirm')
      else void submitChangePin(next)
    }
  }

  async function submitChangePin(confirm: string) {
    if (confirm !== pinNew) {
      setPinError('PINs don\'t match. Try again.')
      setPinNew('')
      setPinConfirm('')
      setPinFlow('change-new')
      return
    }
    setPinWorking(true)
    setPinError('')
    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_pin: pinCurrent, new_pin: pinNew }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setPinError(data.error ?? 'Failed to change PIN.')
        setPinCurrent('')
        setPinNew('')
        setPinConfirm('')
        setPinFlow('change-current')
      } else {
        setPinSuccess('PIN changed successfully.')
        setTimeout(resetPinFlow, 2000)
      }
    } catch {
      setPinError('Network error. Try again.')
      resetPinFlow()
    } finally {
      setPinWorking(false)
    }
  }

  function handleRemovePinKey(key: string) {
    if (key === '⌫') { setPinCurrent((v) => v.slice(0, -1)); setPinError(''); return }
    if (pinCurrent.length >= 6) return
    const next = pinCurrent + key
    setPinCurrent(next)
    if (next.length === 6) void submitRemovePin(next)
  }

  async function submitRemovePin(pin: string) {
    setPinWorking(true)
    setPinError('')
    try {
      const res = await fetch('/api/auth/remove-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_pin: pin }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setPinError(data.error ?? 'Failed to remove PIN.')
        setPinCurrent('')
      } else {
        setPinSuccess('PIN removed.')
        setTimeout(resetPinFlow, 2000)
      }
    } catch {
      setPinError('Network error. Try again.')
      resetPinFlow()
    } finally {
      setPinWorking(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), hostel: hostel.trim(), room_number: room.trim() }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  const hasStreak = !!streak && streak.current_streak_days > 0

  return (
    <>
      <div className="sticky top-0 z-40 glass-thin px-4 py-3" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <BackButton />
          <h1 className="font-semibold">Profile</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5 lx-enter">
        {/* LumeX Wallet — primary entry point (customers had no way to reach it) */}
        <Link
          href="/profile/wallet"
          className="flex items-center gap-3 rounded-2xl p-4 transition-colors"
          style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.25)' }}
        >
          <span className="text-2xl">💰</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold" style={{ color: '#F5A623' }}>LumeX Wallet</p>
            <p className="text-xs text-white/50">Load money, get 1% bonus, checkout faster</p>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>

        {/* Streak — keep the flame alive by ordering each day */}
        {hasStreak && (
          <div className="rounded-2xl p-5 flex items-center justify-between"
            style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }}>
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">🔥</span>
              <div>
                <p className="text-2xl font-bold leading-none" style={{ color: '#F5A623' }}>
                  {streak!.current_streak_days} day{streak!.current_streak_days === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-white/45 mt-1">Order each day to keep your streak alive</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-white/50">Best</p>
              <p className="text-lg font-bold tabular-nums">{streak!.best_streak_days}</p>
            </div>
          </div>
        )}

        {/* Badges — tap one to read what it means + when it was earned */}
        {badges.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white/70">Your badges</h3>
              <span className="text-xs text-white/35">Tap for meaning</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => {
                const active = openBadge === b.badge_id
                return (
                  <button
                    key={b.badge_id}
                    onClick={() => setOpenBadge(active ? null : b.badge_id)}
                    aria-expanded={active}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95"
                    style={{
                      background: active ? 'rgba(245,166,35,0.22)' : 'rgba(245,166,35,0.12)',
                      color: '#F5A623',
                      border: `1px solid ${active ? 'rgba(245,166,35,0.5)' : 'transparent'}`,
                    }}
                  >
                    {b.badges?.emoji && <span aria-hidden="true">{b.badges.emoji}</span>}
                    <span>{b.badges?.name ?? b.badge_id}</span>
                  </button>
                )
              })}
            </div>

            {/* Meaning of the tapped badge — Lumi explains it in her own voice */}
            {(() => {
              const b = badges.find((x) => x.badge_id === openBadge)
              if (!b) return null
              const settled = lumiResult?.id === openBadge
              const hasLumi = settled && !!lumiResult!.text
              const pending = !settled // still waiting on Lumi for this badge
              const meaning = hasLumi ? lumiResult!.text! : (b.badges?.description ?? 'Achievement badge.')
              return (
                <div
                  className="mt-3 rounded-xl p-3 lx-enter"
                  style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.15)' }}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg shrink-0" aria-hidden="true">{b.badges?.emoji ?? '🏅'}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: '#F5A623' }}>{b.badges?.name ?? b.badge_id}</p>
                      <p className="text-xs text-white/70 mt-1 leading-relaxed flex items-start gap-1.5">
                        <span aria-hidden="true" className="shrink-0">{hasLumi ? '✨' : ''}</span>
                        <span>
                          {meaning}
                          {pending && <span className="text-white/35"> · Lumi is explaining…</span>}
                        </span>
                      </p>
                      <p className="text-[11px] text-white/35 mt-1.5">
                        {hasLumi ? 'Lumi · ' : ''}Earned {new Date(b.earned_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Edit profile */}
        <div className="rounded-2xl p-4 space-y-4" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-semibold text-white/70">Your details</h3>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">Phone</label>
            <input
              type="text"
              value={phone}
              disabled
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
            />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
            />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">Hostel / Hall</label>
            <input
              type="text"
              value={hostel}
              onChange={(e) => setHostel(e.target.value)}
              placeholder="e.g., Umuahia Hall"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
            />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">Room number</label>
            <input
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g., A204"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="lx-btn-amber w-full py-3.5 text-sm flex items-center justify-center gap-2"
          >
            {saved && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* What Lumi remembers — user-controlled memory (NDPR + trust) */}
        <LumiMemoryCard />

        {/* Security — PIN management */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-semibold text-white/70">Security</h3>

          {pinSuccess && (
            <p className="text-green-400 text-sm">{pinSuccess}</p>
          )}

          {pinFlow === 'idle' && (
            <div className="space-y-2">
              {/* Face ID / Touch ID — optional second factor */}
              <FaceIdSetup />
              <button
                onClick={() => { resetPinFlow(); setPinFlow('change-current') }}
                className="block w-full text-left text-sm text-white/65 hover:text-white py-1.5 transition-colors"
              >
                Change login PIN
              </button>
              <button
                onClick={() => { resetPinFlow(); setPinFlow('remove') }}
                className="block w-full text-left text-sm py-1.5"
                style={{ color: '#ef4444' }}
              >
                Remove login PIN
              </button>
            </div>
          )}

          {(pinFlow === 'change-current' || pinFlow === 'change-new' || pinFlow === 'change-confirm') && (
            <div className="space-y-3">
              <p className="text-sm text-white/60 text-center">
                {pinFlow === 'change-current' ? 'Enter current PIN' :
                 pinFlow === 'change-new'     ? 'Choose new PIN'    : 'Confirm new PIN'}
              </p>
              <PinIndicators value={
                pinFlow === 'change-current' ? pinCurrent :
                pinFlow === 'change-new'     ? pinNew     : pinConfirm
              } />
              {pinError && <p className="text-red-400 text-xs text-center">{pinError}</p>}
              {pinWorking
                ? <p className="text-center text-sm text-white/40">Saving…</p>
                : <NumericKeypad onKey={handleChangePinKey} />
              }
              <button onClick={resetPinFlow} className="w-full py-1.5 text-xs text-white/30 text-center">Cancel</button>
            </div>
          )}

          {pinFlow === 'remove' && (
            <div className="space-y-3">
              <p className="text-sm text-white/60 text-center">Enter current PIN to confirm removal</p>
              <PinIndicators value={pinCurrent} />
              {pinError && <p className="text-red-400 text-xs text-center">{pinError}</p>}
              {pinWorking
                ? <p className="text-center text-sm text-white/40">Removing…</p>
                : <NumericKeypad onKey={handleRemovePinKey} />
              }
              <button onClick={resetPinFlow} className="w-full py-1.5 text-xs text-white/30 text-center">Cancel</button>
            </div>
          )}
        </div>

        {/* Help & support — number is set by the super-admin in Controls */}
        {supportPhone && supportPhone.trim() && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <h3 className="text-sm font-semibold text-white/70">Help & support</h3>
            <p className="text-xs text-white/45">Order issue or question? Reach the LumeX team.</p>
            <a
              href={`https://wa.me/${supportPhone.replace(/[^\d]/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl p-3 transition-colors"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}
            >
              <span className="text-xl" aria-hidden="true">💬</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Chat on WhatsApp</p>
                <p className="text-xs text-white/50 tabular-nums">{supportPhone}</p>
              </div>
            </a>
            <a href={`tel:${supportPhone.replace(/\s/g, '')}`} className="block text-sm text-white/65 hover:text-white py-1.5 transition-colors">
              Call support
            </a>
          </div>
        )}

        {/* NDPR links */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-semibold text-white/70">Privacy & data</h3>
          <a href="/api/auth/export" className="block text-sm text-white/65 hover:text-white py-1.5 transition-colors">
            Export my data (NDPR)
          </a>
          <a href="/privacy" className="block text-sm text-white/65 hover:text-white py-1.5 transition-colors">
            Privacy policy
          </a>
          <a href="/terms" className="block text-sm text-white/65 hover:text-white py-1.5 transition-colors">
            Terms of service
          </a>
          <button
            className="block text-sm py-1.5 w-full text-left"
            style={{ color: '#ef4444' }}
          >
            Delete account
          </button>
        </div>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          className="w-full rounded-xl py-3.5 text-sm font-medium"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)' }}
        >
          Sign out
        </button>
      </div>
    </>
  )
}
