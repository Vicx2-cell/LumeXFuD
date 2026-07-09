'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'
import { Badge } from '@/components/ui/badge'

interface CronRun {
  at: string
  ok: boolean
  ms: number
  status: number | null
  summary: unknown | null
  error: string | null
}
interface CronStatus {
  key: string
  path: string
  schedule: string
  label: string
  description: string
  money: boolean
  staleMs: number
  lastRun: CronRun | null
  overdue: boolean
}

function timeAgo(iso: string | undefined, now: number): string {
  if (!iso) return 'never'
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function scheduleLabel(expr: string): string {
  switch (expr) {
    case '* * * * *': return 'every minute'
    case '*/5 * * * *': return 'every 5 min'
    case '0 23 * * *': return 'daily 23:00'
    case '0 5 * * *': return 'daily 05:00'
    case '0 8 * * *': return 'daily 08:00'
    case '0 */3 * * *': return 'every 3 hours'
    case '0 23 * * 0': return 'weekly · Sun 23:00'
    default: return expr
  }
}

export default function CronHealthPage() {
  const [jobs, setJobs] = useState<CronStatus[]>([])
  const [now, setNow] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ key: string; text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/cron-health', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to load.'); return }
      setJobs(data.jobs ?? [])
      setNow(Date.parse(data.now) || Date.now())
      setError('')
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const boot = window.setTimeout(() => { void load() }, 0)
    const t = setInterval(load, 30_000)
    return () => {
      window.clearTimeout(boot)
      clearInterval(t)
    }
  }, [load])

  const runNow = async (key: string) => {
    setRunning(key)
    setLastResult(null)
    try {
      const res = await fetch('/api/super-admin/cron-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json()
      if (!res.ok || data.ran === false) {
        setLastResult({ key, ok: false, text: data.error ?? `Failed (${data.status ?? res.status})` })
      } else {
        const summary = data.result ? JSON.stringify(data.result) : `status ${data.status}`
        setLastResult({ key, ok: data.status < 400, text: summary.slice(0, 300) })
      }
      await load()
    } catch {
      setLastResult({ key, ok: false, text: 'Connection error.' })
    } finally {
      setRunning(null)
    }
  }

  const overdueCount = jobs.filter((j) => j.overdue).length
  const moneyOverdue = jobs.filter((j) => j.overdue && j.money).length

  return (
    <div className="lx-page lx-console px-5 py-10 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-2xl">
        <PageHeader title="Cron Health" badge="Super Admin" />
        <p className="text-sm text-white/45 mb-6">
          Background jobs and their last heartbeat. A job that stops running silently can strand money —
          if one is <span className="text-red-400 font-medium">overdue</span>, run it now and check Vercel.
        </p>

        {!loading && (
          <div
            className="rounded-2xl border p-4 mb-5 flex items-center gap-3"
            style={
              moneyOverdue > 0
                ? { background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.35)' }
                : overdueCount > 0
                ? { background: 'rgba(245,166,35,0.10)', borderColor: 'rgba(245,166,35,0.30)' }
                : { background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.30)' }
            }
          >
            <span className="text-2xl">{moneyOverdue > 0 ? '🔴' : overdueCount > 0 ? '🟠' : '🟢'}</span>
            <div className="text-sm">
              <p className="font-semibold text-white">
                {moneyOverdue > 0
                  ? `${moneyOverdue} money job${moneyOverdue === 1 ? '' : 's'} overdue — investigate now`
                  : overdueCount > 0
                  ? `${overdueCount} job${overdueCount === 1 ? '' : 's'} overdue`
                  : 'All jobs healthy'}
              </p>
              <p className="text-white/45">{jobs.length} scheduled jobs · auto-refreshing every 30s</p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
        {loading && <p className="text-sm text-white/40">Loading…</p>}

        <div className="space-y-3">
          {jobs.map((j) => {
            const run = j.lastRun
            const ranOk = run?.ok
            const dot = j.overdue ? '#EF4444' : ranOk ? '#22C55E' : run ? '#F5A623' : '#6B7280'
            return (
              <div
                key={j.key}
                className="rounded-2xl border p-4"
                style={{
                  background: j.overdue ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
                  borderColor: j.overdue ? 'rgba(239,68,68,0.30)' : 'rgba(255,255,255,0.10)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dot }} />
                      <p className="font-semibold text-white truncate">{j.label}</p>
                      {j.money && (
                        <Badge color="#F5A623" className="text-[10px] uppercase tracking-wider">money</Badge>
                      )}
                      {j.overdue && (
                        <Badge color="#FCA5A5" className="text-[10px] uppercase tracking-wider">overdue</Badge>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-1">{j.description}</p>
                    <p className="text-xs text-white/35 mt-1.5">
                      {scheduleLabel(j.schedule)} · last run {timeAgo(run?.at, now)}
                      {run && run.status != null && ` · HTTP ${run.status}`}
                      {run && typeof run.ms === 'number' && ` · ${run.ms}ms`}
                    </p>
                    {run?.error && <p className="text-xs text-red-400 mt-1 truncate">⚠ {run.error}</p>}
                    {run?.summary != null && !run.error && (
                      <p className="text-[11px] text-white/35 mt-1 truncate font-mono">{JSON.stringify(run.summary)}</p>
                    )}
                    {lastResult?.key === j.key && (
                      <p className={`text-[11px] mt-1.5 font-mono break-all ${lastResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                        {lastResult.ok ? '✓ ' : '✗ '}{lastResult.text}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => runNow(j.key)}
                    disabled={running !== null}
                    className="lx-btn-amber shrink-0 px-3 py-2 text-xs disabled:opacity-50"
                  >
                    {running === j.key ? 'Running…' : 'Run now'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
