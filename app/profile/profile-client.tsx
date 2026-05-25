'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomerProfile, XPData, BadgeItem } from './page'

const LEVEL_NAMES = ['', 'Newcomer', 'Regular', 'Foodie', 'Fanatic', 'Loyalist', 'Champion', 'Legend', 'Icon', 'Elite', 'ABSU OG']

export function ProfileClient({
  profile,
  xp,
  badges,
  phone,
}: {
  profile: CustomerProfile | null
  xp: XPData | null
  badges: BadgeItem[]
  phone: string
}) {
  const router = useRouter()
  const [name, setName] = useState(profile?.name ?? '')
  const [hostel, setHostel] = useState(profile?.hostel ?? '')
  const [room, setRoom] = useState(profile?.room_number ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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

  const xpToNext = xp ? (xp.level < 10 ? [100,300,600,1000,1500,2500,4000,6000,9000][xp.level - 1] : 9999) - xp.total_xp : 0

  return (
    <>
      <div className="sticky top-0 z-40 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto">
          <h1 className="font-semibold">Profile</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {/* Gamification panel */}
        {xp && (
          <div className="rounded-2xl p-5 space-y-4"
            style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.15)' }}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-white/50">Your level</p>
                <p className="text-xl font-bold mt-0.5" style={{ color: '#F5A623' }}>{LEVEL_NAMES[xp.level]}</p>
                <p className="text-xs text-white/40 mt-0.5">Level {xp.level} • {xp.total_xp.toLocaleString()} XP</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/50">Weekly XP</p>
                <p className="text-lg font-bold">{xp.weekly_xp}</p>
              </div>
            </div>

            {/* XP progress bar */}
            {xp.level < 10 && (
              <div>
                <div className="flex justify-between text-xs text-white/40 mb-1.5">
                  <span>{xp.total_xp} XP</span>
                  <span>{xpToNext} XP to Level {xp.level + 1}</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      background: '#F5A623',
                      width: `${Math.min(100, (xp.total_xp / ([100,300,600,1000,1500,2500,4000,6000,9000][xp.level - 1] ?? 9000)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Streak */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔥</span>
                <div>
                  <p className="text-sm font-bold">{xp.current_streak_days} day streak</p>
                  <p className="text-xs text-white/40">Best: {xp.best_streak_days} days</p>
                </div>
              </div>
              {xp.streak_freeze_count > 0 && (
                <div className="flex items-center gap-1 text-xs text-blue-400">
                  <span>🧊</span>
                  <span>{xp.streak_freeze_count} freeze{xp.streak_freeze_count !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Badges */}
        {badges.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h3 className="text-sm font-semibold text-white/70 mb-3">Your badges</h3>
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => (
                <div
                  key={b.badge_id}
                  className="px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623' }}
                  title={b.badges?.description ?? ''}
                >
                  {b.badges?.name ?? b.badge_id}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit profile */}
        <div className="rounded-2xl p-4 space-y-4" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
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
            className="w-full rounded-xl py-3.5 font-semibold text-sm disabled:opacity-50"
            style={{ background: '#F5A623', color: '#000' }}
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* NDPR links */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
          <h3 className="text-sm font-semibold text-white/70">Privacy & data</h3>
          <a href="/api/auth/export" className="block text-sm text-white/60 hover:text-white py-1">
            📥 Export my data (NDPR)
          </a>
          <a href="/privacy" className="block text-sm text-white/60 hover:text-white py-1">
            📄 Privacy policy
          </a>
          <a href="/terms" className="block text-sm text-white/60 hover:text-white py-1">
            📋 Terms of service
          </a>
          <button
            className="block text-sm py-1 w-full text-left"
            style={{ color: '#ef4444' }}
          >
            🗑️ Delete account
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
