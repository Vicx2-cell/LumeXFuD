import type { FaqItem } from '@/lib/seo/guides'

// Visible FAQ — rendered from the SAME array that feeds the FAQPage JSON-LD, so
// the structured data always matches what the reader sees. Plain server markup,
// no client JS (native <details> handles expand/collapse, fine on 2G).
export function FaqList({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="mt-10" aria-labelledby="faq-h">
      <h2 id="faq-h" className="lx-display text-xl font-bold mb-4">Frequently asked questions</h2>
      <div className="space-y-2.5">
        {items.map((f, i) => (
          <details key={i} className="glass-thin rounded-xl p-4 group">
            <summary className="font-medium text-sm cursor-pointer list-none flex items-center justify-between gap-3">
              {f.question}
              <span className="text-white/40 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <p className="text-sm text-white/70 mt-2.5 leading-relaxed">{f.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
