'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

type PayoutsMode = 'auto' | 'manual' | 'frozen'

interface Controls {
  withdrawals_frozen: boolean
  payouts_mode: PayoutsMode
  maintenance_enabled: boolean
  maintenance_message: string
  notifications_paused: boolean
  support_phone: string
  hours_open: string
  hours_close: string
  enforce_hours: boolean
  auto_cancel_minutes: number
  ai_provider: 'anthropic' | 'gemini'
}

interface ChangeRow {
  actor_id: string | null
  new_value: Record<string, unknown> | null
  created_at: string
}

function Toggle({ on, onClick, danger }: { on: boolean; onClick: () => void; danger?: boolean }) {
  const accent = danger ? '#EF4444' : '#22C55E'
  return (
    <button onClick={onClick} role="switch" aria-checked={on}
      className="relative w-12 h-7 rounded-full transition-colors shrink-0"
      style={{ background: on ? accent : 'rgba(255,255,255,0.15)' }}>
      <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 26 : 4 }} />
    </button>
  )
}

const PAYOUTS_LABEL: Record<PayoutsMode, string> = { auto: 'Auto', manual: 'Manual', frozen: 'Frozen' }

export default function ControlsPage() {
  const router = useRouter()
  const [c, setC] = useState<Controls | null>(null)
  const [recent, setRecent] = useState<ChangeRow[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  // Money-section confirm dialog: holds the pending change + a typed-CONFIRM gate.
  const [confirmDlg, setConfirmDlg] = useState<{ title: string; body: string; partial: Partial<Controls>; msg: string } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  async function load() {
    const res = await fetch('/api/super-admin/controls')
    if (res.status === 401 || res.status === 403) { router.push('/auth'); return }
    if (res.ok) {
      const d = await res.json() as { controls: Controls; recent?: ChangeRow[] }
      setC(d.controls)
      setRecent(d.recent ?? [])
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(partial: Partial<Controls>, msg: string) {
    if (!c) return
    setBusy(true)
    const prev = c
    setC({ ...c, ...partial }) // optimistic
    try {
      const res = await fetch('/api/super-admin/controls', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial),
      })
      if (res.ok) {
        const d = await res.json() as { controls: Controls }
        setC(d.controls)
        showToast(msg)
        load() // refresh the recent-changes strip
      }
      else { setC(prev); showToast('Could not save') }
    } catch { setC(prev); showToast('Network error') }
    finally { setBusy(false) }
  }

  // Route a money change through the confirm dialog (spec: every Money change
  // requires typing CONFIRM).
  function askConfirm(title: string, body: string, partial: Partial<Controls>, msg: string) {
    setConfirmText('')
    setConfirmDlg({ title, body, partial, msg })
  }

  if (!c) return <div className="lx-page flex items-center justify-center"><p className="text-white/40">Loading…</p></div>

  return (
    <div className="lx-page lx-console px-5 py-10 overflow-hidden">
      <GlassSheen />
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>}

      {/* Money confirm dialog */}
      {confirmDlg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="lx-surface w-full max-w-sm p-5" style={{ border: '1px solid rgba(239,68,68,0.4)' }}>
            <p className="font-bold text-white text-lg mb-1">{confirmDlg.title}</p>
            <p className="text-sm text-white/55 mb-4">{confirmDlg.body}</p>
            <label className="text-xs text-white/50 block mb-1">Type <span className="font-mono text-amber-400">CONFIRM</span> to proceed</label>
            <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="CONFIRM"
              className="lx-field w-full px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setConfirmDlg(null)} className="flex-1 rounded-xl py-2.5 text-sm font-medium"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}>Cancel</button>
              <button
                disabled={confirmText.trim() !== 'CONFIRM'}
                onClick={() => { const d = confirmDlg; setConfirmDlg(null); patch(d.partial, d.msg) }}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40"
                style={{ background: '#EF4444', color: '#fff' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-lg lx-enter">
        <PageHeader title="Controls" badge="Super Admin" />

        {/* Status */}
        <p className="lx-mono text-red-400/80 mb-2">🚨 Status</p>
        <div className="lx-surface divide-y divide-white/8 mb-6" style={{ border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-white">Maintenance mode</p>
                <p className="text-xs text-white/45 mt-0.5">Pauses all new orders and shows customers the message below.</p>
              </div>
              <Toggle on={c.maintenance_enabled} danger onClick={() => patch({ maintenance_enabled: !c.maintenance_enabled }, c.maintenance_enabled ? 'Maintenance OFF' : 'Maintenance ON')} />
            </div>
            <textarea value={c.maintenance_message} onChange={(e) => setC({ ...c, maintenance_message: e.target.value.slice(0, 300) })}
              onBlur={() => patch({ maintenance_message: c.maintenance_message }, 'Message saved')} rows={2}
              className="lx-field w-full mt-3 px-3 py-2 text-sm resize-none" />
          </div>
        </div>

        {/* Money — protected by confirm dialog */}
        <p className="lx-mono text-red-400/80 mb-2">💰 Money</p>
        <div className="lx-surface divide-y divide-white/8 mb-6" style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
          <div className="p-4">
            <p className="font-semibold text-white">Payouts</p>
            <p className="text-xs text-white/45 mt-0.5 mb-3">Gates the 15-min auto-release of vendor/rider earnings. <b>Frozen</b> stops all fund movement now; <b>Manual</b> pauses auto-release for admin to handle.</p>
            <div className="grid grid-cols-3 gap-2">
              {(['auto', 'manual', 'frozen'] as const).map((m) => {
                const on = c.payouts_mode === m
                const danger = m !== 'auto'
                return (
                  <button key={m} onClick={() => {
                    if (m === c.payouts_mode) return
                    askConfirm(`Set payouts to ${PAYOUTS_LABEL[m]}?`,
                      m === 'auto' ? 'Earnings will auto-release again on the 15-min timer.' : 'This stops automatic release of vendor/rider earnings.',
                      { payouts_mode: m }, `Payouts: ${PAYOUTS_LABEL[m]}`)
                  }}
                    className="rounded-xl py-2.5 text-sm font-semibold transition-colors"
                    style={{
                      background: on ? (danger ? '#EF4444' : '#22C55E') : 'rgba(255,255,255,0.05)',
                      color: on ? '#fff' : 'rgba(255,255,255,0.7)',
                      border: `1px solid ${on ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
                    }}>{PAYOUTS_LABEL[m]}</button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-white">Freeze all withdrawals</p>
              <p className="text-xs text-white/45 mt-0.5">Stops every vendor/rider bank withdrawal instantly. Use during fraud or payout failures.</p>
            </div>
            <Toggle on={c.withdrawals_frozen} danger onClick={() => askConfirm(
              c.withdrawals_frozen ? 'Resume withdrawals?' : 'Freeze all withdrawals?',
              c.withdrawals_frozen ? 'Vendors and riders will be able to withdraw again.' : 'No vendor or rider will be able to withdraw to their bank.',
              { withdrawals_frozen: !c.withdrawals_frozen }, c.withdrawals_frozen ? 'Withdrawals resumed' : 'Withdrawals FROZEN')} />
          </div>
        </div>

        {/* AI provider */}
        <p className="lx-mono mb-2">🤖 AI provider</p>
        <div className="lx-surface mb-6">
          <div className="p-4">
            <p className="font-semibold text-white">Active AI provider</p>
            <p className="text-xs text-white/45 mt-0.5 mb-3">Which engine powers ALL AI — Lumi, menu reader, Sentinel, dispute concierge, vendor/rider helpers, study. One switch, whole app. (The “AI features” master flag still turns AI off entirely.)</p>
            <div className="grid grid-cols-2 gap-2">
              {(['gemini', 'anthropic'] as const).map((p) => {
                const on = c.ai_provider === p
                const label = p === 'gemini' ? 'Gemini' : 'Anthropic'
                return (
                  <button key={p} onClick={() => { if (p !== c.ai_provider) patch({ ai_provider: p }, `AI provider: ${label}`) }}
                    className="rounded-xl py-2.5 text-sm font-semibold transition-colors"
                    style={{
                      background: on ? '#F5A623' : 'rgba(255,255,255,0.05)',
                      color: on ? '#000' : 'rgba(255,255,255,0.7)',
                      border: `1px solid ${on ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
                    }}>{label}</button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Operations */}
        <p className="lx-mono mb-2">Operations</p>
        <div className="lx-surface divide-y divide-white/8">
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-white">Pause notifications</p>
              <p className="text-xs text-white/45 mt-0.5">Stops all WhatsApp/SMS sends (e.g. if costs spike or messages misfire).</p>
            </div>
            <Toggle on={c.notifications_paused} danger onClick={() => patch({ notifications_paused: !c.notifications_paused }, c.notifications_paused ? 'Notifications on' : 'Notifications paused')} />
          </div>

          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-white">Enforce opening hours</p>
              <p className="text-xs text-white/45 mt-0.5">Block orders outside the hours below (Africa/Lagos).</p>
            </div>
            <Toggle on={c.enforce_hours} onClick={() => patch({ enforce_hours: !c.enforce_hours }, c.enforce_hours ? 'Hours not enforced' : 'Hours enforced')} />
          </div>
          <div className="flex items-center gap-3 p-4">
            <div className="flex-1">
              <label className="text-xs text-white/50 block mb-1">Opens</label>
              <input type="time" value={c.hours_open} onChange={(e) => setC({ ...c, hours_open: e.target.value })} onBlur={() => patch({ hours_open: c.hours_open }, 'Hours saved')}
                className="lx-field w-full px-3 py-2 text-sm" style={{ colorScheme: 'dark' }} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-white/50 block mb-1">Closes</label>
              <input type="time" value={c.hours_close} onChange={(e) => setC({ ...c, hours_close: e.target.value })} onBlur={() => patch({ hours_close: c.hours_close }, 'Hours saved')}
                className="lx-field w-full px-3 py-2 text-sm" style={{ colorScheme: 'dark' }} />
            </div>
          </div>

          <div className="p-4">
            <label className="text-xs text-white/50 block mb-1">Auto-cancel unaccepted orders after (minutes, 0 = off)</label>
            <input type="number" min={0} max={120} value={c.auto_cancel_minutes}
              onChange={(e) => setC({ ...c, auto_cancel_minutes: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })}
              onBlur={() => patch({ auto_cancel_minutes: c.auto_cancel_minutes }, 'Auto-cancel saved')}
              className="lx-field w-full px-3 py-2 text-sm" />
          </div>

          <div className="p-4">
            <label className="text-xs text-white/50 block mb-1">Support contact (shown to users)</label>
            <input value={c.support_phone} onChange={(e) => setC({ ...c, support_phone: e.target.value })} onBlur={() => patch({ support_phone: c.support_phone }, 'Support contact saved')} placeholder="+234…"
              className="lx-field w-full px-3 py-2 text-sm" />
          </div>
        </div>

        {/* Recent changes */}
        {recent.length > 0 && (
          <div className="mt-6">
            <p className="lx-mono mb-2">Last {recent.length} changes</p>
            <div className="lx-surface divide-y divide-white/8">
              {recent.map((r, i) => (
                <div key={i} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-xs text-white/70 truncate">{r.new_value ? Object.keys(r.new_value).join(', ') : '—'}</p>
                    <p className="text-[11px] text-white/35 mt-0.5">{r.actor_id ?? 'system'}</p>
                  </div>
                  <p className="text-[11px] text-white/35 shrink-0">{new Date(r.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-white/30 text-center mt-4">Changes take effect within ~15 seconds, no redeploy. {busy ? 'Saving…' : ''}</p>
      </div>
    </div>
  )
}
