import { redirect } from 'next/navigation'
import { getControls } from '@/lib/controls'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { GlassSheen } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'
import { LogoutButton } from '@/components/logout-button'
import { Badge } from '@/components/ui/badge'
import { SUPPORT_EMAIL } from '@/components/site-footer'
import { ContactForm } from '@/app/contact/contact-form'

export const dynamic = 'force-dynamic'

export default async function VendorSupportPage() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor') {
    redirect('/auth?next=/vendor-dashboard/support')
  }

  const controls = await getControls()
  const phone = (controls.support_phone ?? '').trim()
  const waDigits = phone.replace(/[^\d]/g, '')
  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('shop_name, owner_name, email, slug')
    .eq('id', session.userId)
    .maybeSingle()
  const supportName = (vendor?.owner_name ?? vendor?.shop_name ?? session.name ?? 'Vendor').trim()
  const supportEmail = (vendor?.email ?? '').trim()
  const supportSubject = vendor?.shop_name ? `Support request for ${vendor.shop_name}` : 'Vendor support request'
  const supportReference = vendor?.slug ? `vendor:${vendor.slug}` : ''

  return (
    <div className="lx-page lx-console overflow-hidden pb-16">
      <GlassSheen />
      <div className="mx-auto max-w-5xl px-4 pt-6">
        <PageHeader
          title="Support"
          subtitle="Use this page when something needs human attention."
          badge="Vendor"
          actions={<LogoutButton />}
        />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        <section className="lx-surface p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Send a case</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Open a support request in the admin queue</h2>
            </div>
            <Badge color="rgba(255,255,255,0.28)">Visible to support</Badge>
          </div>

          <p className="mt-3 text-sm text-white/55">
            This saves your request inside LumeX so support can see it even if email is delayed.
          </p>

          <div className="mt-4">
            <ContactForm
              defaultIntent="support"
              hideIntent
              defaultName={supportName}
              defaultEmail={supportEmail}
              defaultSubject={supportSubject}
              defaultReference={supportReference}
              submitLabel="Send support request"
            />
          </div>
        </section>

        <section className="lx-surface p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Reach us</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Order, payout, or account issues</h2>
            </div>
            <Badge color="rgba(255,255,255,0.28)">Human support</Badge>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SupportCard
              title="Order issue"
              desc="Something went wrong with an order, cancellation, or customer handoff."
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Vendor order issue')}`}
              cta="Email support"
            />
            <SupportCard
              title="Payout issue"
              desc="A payout, earnings, or withdrawal issue needs attention."
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Vendor payout issue')}`}
              cta="Email finance support"
            />
            <SupportCard
              title="Account issue"
              desc="Login, verification, or store access needs help."
              href={waDigits ? `https://wa.me/${waDigits}` : `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Vendor account issue')}`}
              cta={waDigits ? 'WhatsApp us' : 'Email support'}
            />
          </div>
        </section>

        <section className="lx-surface p-4 md:p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">Direct contact</p>
          <div className="mt-3 space-y-2 text-sm text-white/75">
            <p>
              Email: <a className="text-[#F5A623]" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
            {phone ? (
              <p>
                Phone: <a className="text-[#F5A623]" href={`tel:+${waDigits}`}>{phone}</a>
              </p>
            ) : (
              <p className="text-white/45">Phone support is not set yet. Email is the fastest route.</p>
            )}
            <p className="text-white/45">We respond to urgent vendor issues as soon as possible during operating hours.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function SupportCard({ title, desc, href, cta }: { title: string; desc: string; href: string; cta: string }) {
  return (
    <a href={href} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 transition hover:border-white/14 hover:bg-white/[0.05]">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs text-white/45">{desc}</p>
      <p className="mt-4 text-xs font-semibold text-[#F5A623]">{cta}</p>
    </a>
  )
}
