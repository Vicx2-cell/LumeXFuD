'use client'

import { useEffect, useState } from 'react'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'

export default function ShareStorePage() {
  const [vendor, setVendor] = useState<{ id: string; shop_name?: string } | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { id?: string; shop_name?: string } | null) => { if (d?.id) setVendor({ id: d.id, shop_name: d.shop_name }) })
      .catch(() => {})
  }, [])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lumexfud.com.ng'
  const url = vendor ? `${origin}/vendor/${vendor.id}` : ''
  const shop = vendor?.shop_name ?? 'our kitchen'

  function copy(text: string, id: string) {
    try { void navigator.clipboard?.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 2000) } catch { /* ignore */ }
  }

  // Ready-made captions for different places — each copied separately.
  const captions: Array<{ id: string; label: string; text: string }> = vendor ? [
    { id: 'link',     label: 'Just the link',        text: url },
    { id: 'whatsapp', label: 'WhatsApp',             text: `🍲 Order from ${shop} on LumeX!\nFresh food, delivered to your hostel. Tap to see the menu & order 👇\n${url}` },
    { id: 'status',   label: 'WhatsApp / IG status', text: `Hungry? 😋 Order from ${shop} now — delivered on campus.\n${url}` },
    { id: 'bio',      label: 'Instagram / TikTok bio', text: `🍴 Order online: ${url}` },
    { id: 'flyer',    label: 'Flyer / poster',       text: `${shop} is now on LumeX Fud 🎉\nOrder online and get it delivered anywhere on campus:\n${url}` },
  ] : []

  return (
    <div className="lx-page lx-console px-5 py-10 overflow-hidden">
      <GlassSheen />
      <div className="mx-auto max-w-lg lx-enter">
        <PageHeader title="Share your store" subtitle="Your store link, ready to paste anywhere. Customers tap it and order straight from you — new ones sign up and come right back." />

        {!vendor ? (
          <p className="text-white/40 text-sm text-center py-8">Loading…</p>
        ) : (
          <div className="space-y-3">
            {captions.map((c) => (
              <div key={c.id} className="lx-surface p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="lx-mono">{c.label}</p>
                  <button onClick={() => copy(c.text, c.id)} aria-label={`Copy ${c.label} text`} className="lx-tap text-xs font-semibold px-4 min-h-[40px] shrink-0 rounded-lg"
                    style={{ background: copied === c.id ? 'rgba(34,197,94,0.15)' : 'rgba(245,166,35,0.15)', color: copied === c.id ? '#22C55E' : '#F5A623', border: `1px solid ${copied === c.id ? 'rgba(34,197,94,0.3)' : 'rgba(245,166,35,0.25)'}` }}>
                    {copied === c.id ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
                <p className="text-sm text-white/75 whitespace-pre-line break-words">{c.text}</p>
              </div>
            ))}

            <a href={`https://wa.me/?text=${encodeURIComponent(captions[1].text)}`} target="_blank" rel="noopener noreferrer"
              className="lx-tap flex items-center justify-center text-center min-h-[48px] py-3 rounded-xl text-sm font-semibold mt-2" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
              Open WhatsApp to share now
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
