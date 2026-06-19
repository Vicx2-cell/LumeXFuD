'use client'

import { useCallback, useEffect, useState } from 'react'
import { BackButton } from '@/components/back-button'

type CheckStatus = 'pass' | 'warn' | 'fail'
interface SecurityCheck {
  id: string
  category: string
  label: string
  status: CheckStatus
  detail: string
  severity: 'critical' | 'high' | 'medium' | 'low'
}

const DOT: Record<CheckStatus, string> = { pass: '#22C55E', warn: '#F5A623', fail: '#EF4444' }
const ICON: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✕' }

export default function SecurityHealthPage() {
  const [checks, setChecks] = useState<SecurityCheck[]>([])
  const [posture, setPosture] = useState<CheckStatus | null>(null)
  const [counts, setCounts] = useState<{ fail: number; warn: number; pass: number } | null>(null)
  const [ranAt, setRanAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lockdown, setLockdown] = useState<boolean | null>(null)
  const [lockBusy, setLockBusy] = useState(false)

  const loadLockdown = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/lockdown', { cache: 'no-store' })
      const d = await res.json()
      if (res.ok) setLockdown(!!d.enabled)
    } catch { /* leave unknown */ }
  }, [])

  const [rekeyBusy, setRekeyBusy] = useState(false)
  const rekey = async () => {
    if (!window.confirm('Re-key everything? This signs out EVERY user on every device immediately — any stolen login token dies and everyone must log in again. Your current session stays active. Continue?')) return
    setRekeyBusy(true)
    try {
      const res = await fetch('/api/super-admin/revoke-sessions', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not re-key.'); return }
      window.alert(`Done — ${d.revoked} session(s) signed out. Every other device must log in again.`)
    } catch { setError('Connection error.') } finally { setRekeyBusy(false) }
  }

  const toggleLockdown = async () => {
    const next = !lockdown
    const msg = next
      ? 'LOCK DOWN the platform now? Every customer, vendor, rider and admin will be instantly logged out and unable to log in. Only YOU (super admin) will have access. Reversible.'
      : 'Lift lockdown and restore access for everyone?'
    if (!window.confirm(msg)) return
    setLockBusy(true)
    try {
      const res = await fetch('/api/super-admin/lockdown', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not change lockdown.'); return }
      setLockdown(!!d.enabled)
    } catch { setError('Connection error.') } finally { setLockBusy(false) }
  }

  const run = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/super-admin/security-health', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to run checks.'); return }
      setChecks(data.checks ?? [])
      setPosture(data.posture ?? null)
      setCounts(data.counts ?? null)
      setRanAt(data.ran_at ?? '')
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { run(); loadLockdown() }, [run, loadLockdown])

  const categories = Array.from(new Set(checks.map((c) => c.category)))

  return (
    <div className="min-h-dvh px-5 py-10" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <BackButton fallback="/super-admin" />
          <button onClick={run} disabled={loading}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-black disabled:opacity-50" style={{ background: '#F5A623' }}>
            {loading ? 'Running…' : 'Re-run checks'}
          </button>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Security Health</h1>
        <p className="text-sm text-white/45 mb-6">
          A live self-audit of your secrets, encryption, access control and network hardening — including an
          active probe that tries to read private data with the public key. Re-run it any time.
        </p>

        {/* Emergency response — the "inject security" panic switch */}
        <div className="rounded-2xl border p-4 mb-5"
          style={lockdown ? { background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.45)' } : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.10)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-white flex items-center gap-2">
                {lockdown && <span>🔒</span>}Emergency lockdown
              </p>
              <p className="text-xs text-white/50 mt-1">
                {lockdown === null ? 'Checking status…'
                  : lockdown ? 'ACTIVE — everyone except you is locked out right now.'
                  : 'One tap locks out every customer, vendor, rider and admin. Only you keep access.'}
              </p>
            </div>
            <button onClick={toggleLockdown} disabled={lockBusy || lockdown === null}
              className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50"
              style={lockdown
                ? { background: 'rgba(34,197,94,0.18)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.4)' }
                : { background: '#EF4444', color: '#fff' }}>
              {lockBusy ? 'Working…' : lockdown ? 'Lift lockdown' : 'LOCK DOWN'}
            </button>
          </div>
          {lockdown && (
            <p className="text-[11px] text-white/40 mt-2">Changes propagate within ~15s across all servers. Your own access is never affected.</p>
          )}

          <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-white">🔑 Re-key everything</p>
              <p className="text-xs text-white/50 mt-1">Sign out every device & kill every login token instantly (a stolen token dies). Your session stays.</p>
            </div>
            <button onClick={rekey} disabled={rekeyBusy}
              className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: '#7c3aed' }}>
              {rekeyBusy ? 'Working…' : 'Re-key'}
            </button>
          </div>
        </div>

        {posture && counts && (
          <div className="rounded-2xl border p-4 mb-5 flex items-center gap-3"
            style={
              posture === 'fail' ? { background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.35)' }
              : posture === 'warn' ? { background: 'rgba(245,166,35,0.10)', borderColor: 'rgba(245,166,35,0.30)' }
              : { background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.30)' }
            }>
            <span className="text-2xl">{posture === 'fail' ? '🔴' : posture === 'warn' ? '🟠' : '🟢'}</span>
            <div className="text-sm">
              <p className="font-semibold text-white">
                {posture === 'fail' ? `${counts.fail} problem${counts.fail === 1 ? '' : 's'} to fix`
                  : posture === 'warn' ? `${counts.warn} thing${counts.warn === 1 ? '' : 's'} to review`
                  : 'All security checks passing'}
              </p>
              <p className="text-white/45">
                {counts.pass} passing · {counts.warn} warnings · {counts.fail} failing
                {ranAt && ` · ran ${new Date(ranAt).toLocaleTimeString()}`}
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
        {loading && checks.length === 0 && <p className="text-sm text-white/40">Running security checks…</p>}

        <div className="space-y-5">
          {categories.map((cat) => (
            <div key={cat}>
              <p className="text-xs uppercase tracking-[0.18em] text-white/35 mb-2">{cat}</p>
              <div className="space-y-2">
                {checks.filter((c) => c.category === cat).map((c) => (
                  <div key={c.id} className="rounded-2xl border p-4"
                    style={{
                      background: c.status === 'fail' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
                      borderColor: c.status === 'fail' ? 'rgba(239,68,68,0.30)' : 'rgba(255,255,255,0.10)',
                    }}>
                    <div className="flex items-start gap-3">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0 mt-0.5"
                        style={{ background: DOT[c.status], color: '#0A0A0B' }}>{ICON[c.status]}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-white">{c.label}</p>
                          {(c.severity === 'critical' || c.severity === 'high') && c.status !== 'pass' && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(239,68,68,0.18)', color: '#FCA5A5' }}>{c.severity}</span>
                          )}
                        </div>
                        <p className="text-xs text-white/45 mt-1 break-words">{c.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
