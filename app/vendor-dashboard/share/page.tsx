'use client'

import { useEffect, useState } from 'react'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'

export default function ShareStorePage() {
  const [vendor, setVendor] = useState<{ id: string; shop_name?: string } | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { id?: string; shop_name?: string } | null) => {
        if (d?.id) setVendor({ id: d.id, shop_name: d.shop_name })
      })
      .catch(() => {})
  }, [])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lumexfud.com.ng'
  const url = vendor ? `${origin}/vendor/${vendor.id}` : ''
  const shop = vendor?.shop_name ?? 'our kitchen'

  function copy(text: string, id: string) {
    try {
      void navigator.clipboard?.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      // ignore
    }
  }

  const captions: Array<{ id: string; label: string; text: string }> = vendor ? [
    { id: 'link', label: 'Just the link', text: url },
    { id: 'whatsapp', label: 'WhatsApp', text: `Order from ${shop} on LumeX!\nFresh food, delivered to your hostel. Tap to see the menu and order:\n${url}` },
    { id: 'status', label: 'WhatsApp / IG status', text: `Hungry? Order from ${shop} now - delivered on campus.\n${url}` },
    { id: 'bio', label: 'Instagram / TikTok bio', text: `Order online: ${url}` },
  ] : []

  return (
    <div className="lx-page lx-console overflow-hidden px-5 py-10">
      <GlassSheen />
      <div className="mx-auto max-w-lg lx-enter">
        <PageHeader
          title="Share your store"
          subtitle="Your store link, ready to paste anywhere. Customers tap it and order straight from you - new ones sign up and come right back."
        />

        {!vendor ? (
          <p className="py-8 text-center text-sm text-white/40">Loading...</p>
        ) : (
          <div className="space-y-3">
            {captions.map((caption) => (
              <div key={caption.id} className="lx-surface p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="lx-mono">{caption.label}</p>
                  <button
                    onClick={() => copy(caption.text, caption.id)}
                    aria-label={`Copy ${caption.label} text`}
                    className="lx-tap min-h-[40px] shrink-0 rounded-lg px-4 text-xs font-semibold"
                    style={{
                      background: copied === caption.id ? 'rgba(34,197,94,0.15)' : 'rgba(245,166,35,0.15)',
                      color: copied === caption.id ? '#22C55E' : '#F5A623',
                      border: `1px solid ${copied === caption.id ? 'rgba(34,197,94,0.3)' : 'rgba(245,166,35,0.25)'}`,
                    }}
                  >
                    {copied === caption.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="whitespace-pre-line break-words text-sm text-white/75">{caption.text}</p>
              </div>
            ))}

            <a
              href={`https://wa.me/?text=${encodeURIComponent(captions[1].text)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lx-tap mt-2 flex min-h-[48px] items-center justify-center rounded-xl py-3 text-center text-sm font-semibold"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}
            >
              Open WhatsApp to share now
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
