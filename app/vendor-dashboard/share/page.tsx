'use client'

import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Share2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { vendorPath } from '@/lib/seo/config'

export default function ShareStorePage() {
  const [vendor, setVendor] = useState<{ id: string; shop_name?: string; slug?: string | null } | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { id?: string; shop_name?: string; slug?: string | null } | null) => {
        if (d?.id) setVendor({ id: d.id, shop_name: d.shop_name, slug: d.slug ?? null })
      })
      .catch(() => {})
  }, [])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lumexfud.com.ng'
  const storefrontUrl = vendor?.slug ? `${origin}/store/${encodeURIComponent(vendor.slug)}` : ''
  const publicUrl = vendor?.slug ? `${origin}${vendorPath(vendor.slug)}` : ''
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

  const captions: Array<{ id: string; label: string; text: string }> = vendor && storefrontUrl ? [
    { id: 'storefront', label: 'Customer storefront', text: storefrontUrl },
    { id: 'whatsapp', label: 'WhatsApp', text: `Order from ${shop} on LumeX!\nFresh food, delivered to your hostel. Tap to see the menu and order:\n${storefrontUrl}` },
    { id: 'status', label: 'WhatsApp / IG status', text: `Hungry? Order from ${shop} now - delivered on campus.\n${storefrontUrl}` },
    { id: 'bio', label: 'Instagram / TikTok bio', text: `Order online: ${storefrontUrl}` },
    ...(publicUrl ? [{ id: 'profile', label: 'Public profile', text: publicUrl }] : []),
  ] : []

  return (
    <div className="lx-page lx-console min-h-dvh px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-xl lx-enter">
        <PageHeader
          title="Share your store"
          subtitle="Send customers directly to your live menu."
        />

        {!vendor ? (
          <p className="py-8 text-center text-sm text-white/40">Loading...</p>
        ) : (
          <div className="space-y-3">
            {!storefrontUrl && <p className="border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">Your storefront link will appear after your store slug is set.</p>}
            {captions.map((caption) => (
              <div key={caption.id} className="border-y border-white/10 py-4 first:pt-0">
                <div className="mb-2 flex items-center justify-between">
                  <p className="lx-mono">{caption.label}</p>
                  <button
                    onClick={() => copy(caption.text, caption.id)}
                    aria-label={`Copy ${caption.label} text`}
                    className="lx-tap inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold"
                    style={{
                      background: copied === caption.id ? 'rgba(34,197,94,0.15)' : 'rgba(245,166,35,0.15)',
                      color: copied === caption.id ? '#22C55E' : '#F5A623',
                      border: `1px solid ${copied === caption.id ? 'rgba(34,197,94,0.3)' : 'rgba(245,166,35,0.25)'}`,
                    }}
                  >
                    <Copy size={14} /> {copied === caption.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="whitespace-pre-line break-words bg-white/[0.03] px-3 py-2 text-sm text-white/75">{caption.text}</p>
              </div>
            ))}

            {storefrontUrl && <a
              href={`https://wa.me/?text=${encodeURIComponent(captions[1].text)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lx-tap mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-lg py-3 text-center text-sm font-semibold"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}
            >
              <Share2 size={17} /> Share on WhatsApp
            </a>}
            {storefrontUrl && <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="lx-tap flex min-h-[44px] items-center justify-center gap-2 text-sm font-semibold text-white/65 hover:text-white">
              Preview customer storefront <ExternalLink size={15} />
            </a>}
          </div>
        )}
      </div>
    </div>
  )
}
