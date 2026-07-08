'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

type ApplicationKind = 'vendor' | 'rider'
type MerchantCategory = 'restaurant' | 'supermarket' | 'pharmacy'
type VehicleType = 'bike' | 'bicycle' | 'foot'

const merchantOptions: Array<{ value: MerchantCategory; label: string; hint: string }> = [
  { value: 'restaurant', label: 'Restaurant', hint: 'Cooked meals and drinks' },
  { value: 'supermarket', label: 'Supermarket', hint: 'Groceries and household items' },
  { value: 'pharmacy', label: 'Pharmacy', hint: 'Health and care products' },
]

const vehicleOptions: Array<{ value: VehicleType; label: string; hint: string }> = [
  { value: 'bike', label: 'Bike', hint: 'Fastest for campus runs' },
  { value: 'bicycle', label: 'Bicycle', hint: 'Light delivery coverage' },
  { value: 'foot', label: 'On foot', hint: 'Nearby deliveries only' },
]

function normalizePhoneInput(value: string) {
  const raw = value.replace(/\s/g, '')
  if (raw.startsWith('0')) return `+234${raw.slice(1)}`
  if (raw.startsWith('234') && !raw.startsWith('+')) return `+${raw}`
  if (!raw.startsWith('+')) return `+234${raw}`
  return raw
}

export function ApplyForm({ kind }: { kind: ApplicationKind }) {
  const isVendor = kind === 'vendor'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('+234')
  const [area, setArea] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [merchantCategory, setMerchantCategory] = useState<MerchantCategory | ''>('')
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const title = isVendor ? 'Apply as a vendor' : 'Apply as a rider'
  const subtitle = isVendor
    ? 'Tell us about your shop. We will review your details before your merchant account goes live.'
    : 'Tell us how you deliver. We will review your details before your rider account goes live.'
  const checklist = useMemo(
    () => isVendor
      ? ['Your business details', 'Where you operate from', 'A number we can reach', 'Anything admin should know before review']
      : ['Your contact details', 'How you deliver', 'Where you are usually available', 'Anything admin should know before review'],
    [isVendor],
  )

  async function handleSubmit() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name,
          phone,
          area,
          business_name: isVendor ? businessName : undefined,
          merchant_category: isVendor ? merchantCategory || undefined : undefined,
          vehicle_type: !isVendor ? vehicleType || undefined : undefined,
          notes: notes.trim() || undefined,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Could not submit your application right now.')
        return
      }
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-dvh bg-[#0A0A0B] px-5 py-10 text-white">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <div className="rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/75">Application received</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">We have your details.</h1>
            <p className="mt-3 text-sm leading-6 text-white/65">
              Admin will review your application, verify the required checks, and contact you on WhatsApp before activation.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/65">
            <p className="font-medium text-white">What happens next</p>
            <div className="mt-3 space-y-2">
              <p>1. Your application is queued for review.</p>
              <p>2. Admin confirms your details and inspection checklist.</p>
              <p>3. We contact you before your account is approved.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/" className="rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-black">
              Back home
            </Link>
            <Link href="/auth/register" className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white/80">
              Create customer account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-[#0A0A0B] px-5 py-10 text-white">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <section className="space-y-5">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/55 transition-colors hover:text-white/80">
            <span aria-hidden="true">←</span>
            Back to home
          </Link>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-amber-300/70">{isVendor ? 'Merchant onboarding' : 'Rider onboarding'}</p>
            <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-white/65">{subtitle}</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm font-medium text-white">We will ask for</p>
            <div className="mt-4 space-y-3">
              {checklist.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-white/65">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm leading-6 text-white/60">
            <p className="font-medium text-white">Approval note</p>
            <p className="mt-2">
              Submitting this form does not make the account live immediately. Admin still verifies identity and site or vehicle checks before approval.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="grid gap-5">
            <label className="block text-sm text-white/75">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Full name</span>
              <input
                value={name}
                onChange={(event) => { setName(event.target.value); setError('') }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder={isVendor ? 'Shop owner or manager name' : 'Your full name'}
                autoComplete="name"
              />
            </label>

            <label className="block text-sm text-white/75">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">WhatsApp number</span>
              <input
                value={phone}
                onChange={(event) => { setPhone(normalizePhoneInput(event.target.value)); setError('') }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="+2348012345678"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>

            {isVendor ? (
              <>
                <label className="block text-sm text-white/75">
                  <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Business or shop name</span>
                  <input
                    value={businessName}
                    onChange={(event) => { setBusinessName(event.target.value); setError('') }}
                    className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                    placeholder="Mama Chinyere Kitchen"
                    autoComplete="organization"
                  />
                </label>

                <div className="space-y-2">
                  <span className="block text-xs uppercase tracking-[0.18em] text-white/40">Merchant category</span>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {merchantOptions.map((option) => {
                      const active = merchantCategory === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => { setMerchantCategory(option.value); setError('') }}
                          className="rounded-2xl border px-4 py-4 text-left transition-colors"
                          style={{
                            background: active ? 'rgba(245,166,35,0.14)' : 'rgba(255,255,255,0.03)',
                            borderColor: active ? 'rgba(245,166,35,0.42)' : 'rgba(255,255,255,0.08)',
                          }}
                        >
                          <p className="text-sm font-medium text-white">{option.label}</p>
                          <p className="mt-1 text-xs text-white/45">{option.hint}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <span className="block text-xs uppercase tracking-[0.18em] text-white/40">How you deliver</span>
                <div className="grid gap-3 sm:grid-cols-3">
                  {vehicleOptions.map((option) => {
                    const active = vehicleType === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => { setVehicleType(option.value); setError('') }}
                        className="rounded-2xl border px-4 py-4 text-left transition-colors"
                        style={{
                          background: active ? 'rgba(245,166,35,0.14)' : 'rgba(255,255,255,0.03)',
                          borderColor: active ? 'rgba(245,166,35,0.42)' : 'rgba(255,255,255,0.08)',
                        }}
                      >
                        <p className="text-sm font-medium text-white">{option.label}</p>
                        <p className="mt-1 text-xs text-white/45">{option.hint}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <label className="block text-sm text-white/75">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">
                {isVendor ? 'Business location or delivery area' : 'Usual area or base'}
              </span>
              <textarea
                value={area}
                onChange={(event) => { setArea(event.target.value); setError('') }}
                className="min-h-[110px] w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder={isVendor ? 'ABSU, Uturu campus gate area, opposite Faculty of Law...' : 'Uturu, close to ABSU back gate, available afternoons and evenings...'}
              />
            </label>

            <label className="block text-sm text-white/75">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Extra notes</span>
              <textarea
                value={notes}
                onChange={(event) => { setNotes(event.target.value); setError('') }}
                className="min-h-[110px] w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder={isVendor ? 'Opening hours, what you sell, inspection timing, or anything admin should know.' : 'Availability window, route familiarity, or anything admin should know.'}
              />
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-2xl bg-amber-500 px-5 py-4 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? 'Submitting application...' : 'Submit application'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
