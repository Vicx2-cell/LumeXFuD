'use client'

import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'
import { LogoutButton } from '@/components/logout-button'

const svg = (path: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
)

const actions = [
  {
    href: '/super-admin/sentinel',
    label: 'Sentinel',
    desc: 'Live 24/7 platform watch + AI alerts',
    icon: svg(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/controls',
    label: 'Controls',
    desc: 'Kill switches, maintenance, hours, notifications',
    icon: svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/announce',
    label: 'Broadcast',
    desc: 'Post a message on everyone’s screen',
    icon: svg(<><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/financials',
    label: 'Financials',
    desc: 'GMV, take rate, revenue, wallet float',
    icon: svg(<><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/settings',
    label: 'Platform Settings',
    desc: 'Live-edit fees, markups, limits',
    icon: svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/pricing',
    label: 'Pricing',
    desc: 'Markup, delivery fees & rider pay',
    icon: svg(<><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/features',
    label: 'Feature Toggles',
    desc: 'Turn ordering, wallet, sign-ups on/off',
    icon: svg(<><rect x="2" y="6" width="20" height="12" rx="6"/><circle cx="16" cy="12" r="3"/></>),
    highlight: true,
  },
  {
    href: '/super-admin/team/new',
    label: 'Add Admin',
    desc: 'Create an operational admin account',
    icon: svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></>),
  },
  {
    href: '/super-admin/audit',
    label: 'Super Audit Log',
    desc: 'All super-admin actions',
    icon: svg(<><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></>),
  },
  {
    href: '/admin/verify-receipt',
    label: 'Verify Receipt',
    desc: 'Authenticate a wallet receipt',
    icon: svg(<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="m9 12 2 2 4-4"/></>),
  },
  {
    href: '/super-admin/launch-counter',
    label: 'Launch Counter',
    desc: 'Pre-launch “students onboard” progress bar',
    icon: svg(<><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></>),
  },
  {
    href: '/admin',
    label: 'Admin Dashboard',
    desc: 'Vendors, riders, orders, disputes',
    icon: svg(<><path d="M3 9 12 2l9 7"/><path d="M4 10v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10"/><path d="M9 21v-6h6v6"/></>),
  },
]

export default function SuperAdminDashboard() {
  const router = useRouter()

  return (
    <div className="lx-page px-5 py-10 overflow-hidden">
      <div className="relative z-10 mx-auto max-w-2xl lx-enter">
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between"><BackButton /><LogoutButton /></div>
          <span
            className="inline-block px-3 py-1 rounded-lg text-xs font-bold mb-3"
            style={{ background: '#F5A623', color: '#000', boxShadow: '0 0 20px rgba(245,166,35,0.4)' }}
          >
            Super Admin
          </span>
          <h1 className="text-3xl font-bold tracking-tight" style={{ background: 'linear-gradient(135deg,#fff,#F5A623)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            God Mode
          </h1>
          <p className="text-sm text-white/45 mt-1">Full platform control</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lx-stagger">
          {actions.map((a) => (
            <button
              key={a.href}
              onClick={() => router.push(a.href)}
              className={`text-left p-5 transition-transform hover:-translate-y-0.5 ${a.highlight ? 'glass' : 'glass-thin'}`}
              style={a.highlight ? { background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.28)' } : undefined}
            >
              <div className="flex items-center gap-2.5 mb-1">
                <span
                  className="flex items-center justify-center w-9 h-9 rounded-xl"
                  style={{
                    background: a.highlight ? 'rgba(245,166,35,0.18)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${a.highlight ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    color: a.highlight ? '#F5A623' : 'rgba(255,255,255,0.7)',
                  }}
                >
                  {a.icon}
                </span>
                <p className="font-semibold text-white">{a.label}</p>
              </div>
              <p className="text-sm text-white/45">{a.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
