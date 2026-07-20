'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { GlassSheen } from '@/components/fx'

interface VendorRow {
  id: string
  phone: string
  shop_name: string
  owner_name: string
  category: string
  status: string
  approval_state: string
  subscription_tier: string
  subscription_paid_until: string | null
  is_active: boolean
  approved_at: string | null
  avg_rating: number
  total_ratings: number
  created_at: string
}

const TIER_COLORS: Record<string, string> = {
  FOUNDING: '#F5A623',
  EARLY: '#22C55E',
  STANDARD: '#60A5FA',
}

const STATE_LABELS: Record<string, string> = {
  draft: 'Draft',
  application_submitted: 'Application submitted',
  under_review: 'Under review',
  inspection_scheduled: 'Inspection scheduled',
  shop_inspected: 'Shop inspected',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  pending_review: 'Pending review',
}

export default function AdminVendors() {
  const router = useRouter()
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [removeTarget, setRemoveTarget] = useState<VendorRow | null>(null)
  const [removing, setRemoving] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchVendors() {
    const res = await fetch('/api/admin/vendors')
    if (res.ok) {
      const d = await res.json() as { vendors: VendorRow[] }
      setVendors(d.vendors)
    }
    setLoading(false)
  }


  useEffect(() => { fetchVendors() }, [])

  async function doAction(vendorId: string, action: 'review' | 'schedule_inspection' | 'mark_inspected' | 'approve' | 'suspend' | 'unsuspend') {
    setActionLoading(vendorId + action)
    const res = await fetch(`/api/admin/vendors/${vendorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`Vendor ${action}d`)
      await fetchVendors()
    } else {
      showToast(d.error ?? 'Action failed')
    }
    setActionLoading(null)
  }

  async function confirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    const res = await fetch(`/api/admin/vendors/${removeTarget.id}`, { method: 'DELETE' })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`${removeTarget.shop_name} removed`)
      setRemoveTarget(null)
      await fetchVendors()
    } else {
      showToast(d.error ?? 'Could not remove vendor')
    }
    setRemoving(false)
  }

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      {/* Remove confirmation */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center lx-scrim px-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => !removing && setRemoveTarget(null)}>
          <div className="lx-sheet sm:lx-scale-in glass-thick w-full max-w-sm p-6 space-y-4" style={{ borderRadius: 24 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-11 h-11 rounded-2xl shrink-0" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              </span>
              <div>
                <h3 className="font-semibold text-lg">Remove vendor?</h3>
                <p className="text-sm text-white/55">{removeTarget.shop_name}</p>
              </div>
            </div>
            <p className="text-sm text-white/60">
              This hides <strong>{removeTarget.shop_name}</strong> from the app and signs them out. Their past orders and records are kept. You can re-add them later.
            </p>
            <button onClick={confirmRemove} disabled={removing} className="w-full py-3.5 rounded-xl font-semibold disabled:opacity-50" style={{ background: '#EF4444', color: '#fff' }}>
              {removing ? 'Removing…' : 'Yes, remove vendor'}
            </button>
            <button onClick={() => setRemoveTarget(null)} disabled={removing} className="w-full py-2.5 text-sm text-white/55 hover:text-white/80 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="relative z-10 mx-auto max-w-3xl">
        <PageHeader
          title="Vendors"
          subtitle={`${vendors.length} total`}
          badge="Admin"
          actions={
            <button onClick={() => router.push('/admin/vendors/new')}
              className="lx-btn-amber px-4 py-2 text-sm">+ Add</button>
          }
        />

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl lx-skeleton" />
            ))}
          </div>
        ) : vendors.length === 0 ? (
          <EmptyState title="No vendors yet" description="Add your first vendor to get started." />
        ) : (
          <div className="space-y-3">
            {vendors.map((v) => (
              <div key={v.id} className="lx-surface rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{v.shop_name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                        style={{ background: TIER_COLORS[v.subscription_tier] ?? '#666', color: '#000' }}>
                        {v.subscription_tier}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}>
                        {STATE_LABELS[v.approval_state] ?? v.approval_state}
                      </span>
                    </div>
                    <p className="text-sm text-white/40 mt-0.5">{v.owner_name} · {v.phone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-white/40">{v.category}</p>
                    <p className="text-xs text-white/40 mt-0.5">⭐ {v.avg_rating.toFixed(1)} ({v.total_ratings})</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-white/30 mb-3">
                  <span>Status: <span className="text-white/60">{v.status}</span></span>
                  {v.subscription_paid_until && (
                    <span>· Paid until {new Date(v.subscription_paid_until).toLocaleDateString('en-NG')}</span>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {(v.approval_state === 'application_submitted' || v.approval_state === 'draft' || v.approval_state === 'pending_review') && (
                    <button onClick={() => doAction(v.id, 'review')}
                      disabled={actionLoading === v.id + 'review'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(96,165,250,0.15)', color: '#60A5FA', border: '1px solid rgba(96,165,250,0.3)' }}>
                      {actionLoading === v.id + 'review' ? '…' : 'Under review'}
                    </button>
                  )}
                  {v.approval_state === 'under_review' && (
                    <button onClick={() => doAction(v.id, 'schedule_inspection')}
                      disabled={actionLoading === v.id + 'schedule_inspection'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.3)' }}>
                      {actionLoading === v.id + 'schedule_inspection' ? '…' : 'Schedule inspection'}
                    </button>
                  )}
                  {v.approval_state === 'inspection_scheduled' && (
                    <button onClick={() => doAction(v.id, 'mark_inspected')}
                      disabled={actionLoading === v.id + 'mark_inspected'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
                      {actionLoading === v.id + 'mark_inspected' ? '…' : 'Mark inspected'}
                    </button>
                  )}
                  {v.approval_state === 'shop_inspected' && (
                    <button onClick={() => doAction(v.id, 'approve')}
                      disabled={actionLoading === v.id + 'approve'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
                      {actionLoading === v.id + 'approve' ? '…' : 'Approve'}
                    </button>
                  )}
                  {v.approval_state === 'approved' && v.is_active && (
                    <button onClick={() => doAction(v.id, 'suspend')}
                      disabled={actionLoading === v.id + 'suspend'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      {actionLoading === v.id + 'suspend' ? '…' : 'Suspend'}
                    </button>
                  )}
                  {v.approval_state === 'suspended' && !v.is_active && (
                    <button onClick={() => doAction(v.id, 'unsuspend')}
                      disabled={actionLoading === v.id + 'unsuspend'}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'rgba(34,197,94,0.1)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.2)' }}>
                      {actionLoading === v.id + 'unsuspend' ? '…' : 'Unsuspend'}
                    </button>
                  )}
                  <button onClick={() => setRemoveTarget(v)}
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-red-500/20"
                    style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
