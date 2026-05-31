'use client'

import { useRouter } from 'next/navigation'

const actions = [
  {
    href: '/super-admin/financials',
    label: 'Financials',
    desc: 'GMV, take rate, revenue, wallet float',
    icon: '💰',
    highlight: true,
  },
  {
    href: '/super-admin/settings',
    label: 'Platform Settings',
    desc: 'Live-edit fees, markups, limits',
    icon: '⚙️',
    highlight: true,
  },
  {
    href: '/super-admin/team/new',
    label: 'Add Admin',
    desc: 'Create an operational admin account',
    icon: '👤',
  },
  {
    href: '/super-admin/audit',
    label: 'Super Audit Log',
    desc: 'All super-admin actions',
    icon: '📋',
  },
  {
    href: '/admin',
    label: 'Admin Dashboard',
    desc: 'Vendors, riders, orders, disputes',
    icon: '🏛️',
  },
]

export default function SuperAdminDashboard() {
  const router = useRouter()

  return (
    <div className="min-h-dvh px-5 py-10" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <span
            className="inline-block px-3 py-1 rounded-lg text-xs font-bold mb-3"
            style={{ background: '#F5A623', color: '#000' }}
          >
            Super Admin
          </span>
          <h1 className="text-2xl font-bold text-white">God Mode</h1>
          <p className="text-sm text-white/40 mt-1">Full platform control</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {actions.map((a) => (
            <button
              key={a.href}
              onClick={() => router.push(a.href)}
              className="text-left rounded-2xl p-5 transition-colors hover:brightness-110"
              style={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: a.highlight ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.1)',
                background: a.highlight ? 'rgba(245,166,35,0.07)' : 'rgba(255,255,255,0.03)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{a.icon}</span>
                <p className="font-semibold text-white">{a.label}</p>
              </div>
              <p className="text-sm text-white/40">{a.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
