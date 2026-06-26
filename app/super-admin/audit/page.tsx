'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

interface SuperAuditLog {
  id: string
  actor_id: string
  actor_role: string
  action: string
  target_table: string | null
  target_id: string | null
  amount_kobo: number | null
  created_at: string
}

export default function SuperAdminAudit() {
  const [logs, setLogs] = useState<SuperAuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  async function fetchLogs(p: number) {
    setLoading(true)
    const res = await fetch(`/api/super-admin/super-audit?page=${p}`)
    if (res.ok) {
      const d = await res.json() as { logs: SuperAuditLog[]; page: number }
      setLogs(d.logs)
      setHasMore(d.logs.length === 50)
    }
    setLoading(false)
  }

  useEffect(() => { fetchLogs(1) }, [])

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-2xl">
        <PageHeader title="Super Audit Log" badge="Super Admin" />

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lx-skeleton h-14 rounded-xl" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No super admin actions yet</div>
        ) : (
          <>
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div key={log.id} className="lx-surface rounded-xl px-4 py-3 flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: '#F5A623' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">
                      <span className="font-medium">{log.action}</span>
                      {log.target_table && <span className="text-white/40"> on {log.target_table}</span>}
                      {log.target_id && <span className="text-white/30"> ({String(log.target_id).slice(0, 10)}…)</span>}
                    </p>
                    <p className="text-xs text-white/30 mt-0.5">{log.actor_id}</p>
                  </div>
                  <p className="text-xs text-white/30 shrink-0 mt-0.5">
                    {new Date(log.created_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              ))}
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
