'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface AuditLog {
  id: string
  actor_id: string
  actor_role: string
  action: string
  target_table: string
  target_id: string | null
  created_at: string
}

export default function AdminAudit() {
  const router = useRouter()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  async function fetchLogs(p: number) {
    setLoading(true)
    const res = await fetch(`/api/admin/audit?page=${p}`)
    if (res.ok) {
      const d = await res.json() as { logs: AuditLog[]; page: number }
      setLogs(d.logs)
      setHasMore(d.logs.length === 50)
    }
    setLoading(false)
  }

  useEffect(() => { fetchLogs(1) }, [])

  const ACTION_COLORS: Record<string, string> = {
    approve: '#22C55E',
    suspend: '#EF4444',
    unsuspend: '#22C55E',
    refund: '#F97316',
    resolve_dispute: '#60A5FA',
    settings_update: '#F5A623',
  }

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/admin')} className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <h1 className="text-xl font-bold text-white">Audit Log</h1>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No audit logs yet</div>
        ) : (
          <>
            <div className="space-y-1.5">
              {logs.map((log) => {
                const color = Object.entries(ACTION_COLORS).find(([k]) => log.action.includes(k))?.[1] ?? '#aaa'
                return (
                  <div key={log.id} className="rounded-xl px-4 py-3 flex items-center gap-3"
                    style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        <span className="font-medium">{log.action}</span>
                        {log.target_table && <span className="text-white/40"> on {log.target_table}</span>}
                        {log.target_id && <span className="text-white/30"> ({log.target_id.slice(0, 8)}…)</span>}
                      </p>
                      <p className="text-xs text-white/30 mt-0.5">{log.actor_id} · {log.actor_role}</p>
                    </div>
                    <p className="text-xs text-white/30 shrink-0">
                      {new Date(log.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-center gap-4 mt-5">
              <button onClick={() => { const p = page - 1; setPage(p); fetchLogs(p) }}
                disabled={page === 1} className="px-4 py-2 rounded-xl text-sm disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}>← Prev</button>
              <span className="text-sm text-white/40">Page {page}</span>
              <button onClick={() => { const p = page + 1; setPage(p); fetchLogs(p) }}
                disabled={!hasMore} className="px-4 py-2 rounded-xl text-sm disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}>Next →</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
