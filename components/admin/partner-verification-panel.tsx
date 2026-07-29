'use client'

import { useMemo, useState } from 'react'
import { RIDER_VERIFICATION_CHECKS, VENDOR_VERIFICATION_CHECKS } from '@/lib/onboarding'

type Kind = 'vendor' | 'rider'

const LABELS: Record<string, string> = {
  contact_ownership: 'Phone and email ownership confirmed in person',
  government_identity: 'Government identity matches the applicant',
  business_ownership: 'Business ownership or authority confirmed',
  payout_account_match: 'Paystack payout account resolves to the correct person/business',
  food_handler_clearance: 'Food-handler medical clearance is current',
  premises_hygiene: 'Water, handwashing, waste, pest and cleaning controls pass',
  safe_storage: 'Food storage, separation and temperature controls pass',
  packaging_capacity: 'Packaging and peak-hour preparation capacity pass',
  menu_accuracy: 'Menu, prices and availability were checked',
  test_order: 'End-to-end test order was completed',
  guarantor_confirmed: 'Guarantor identity and phone were independently confirmed',
  vehicle_roadworthy: 'Vehicle ownership/permission and roadworthiness pass',
  safety_equipment: 'Helmet and required safety equipment pass',
  smartphone_gps: 'Working smartphone, data and GPS confirmed',
  route_training: 'Campus route and incident training completed',
  test_delivery: 'Supervised test delivery was completed',
}

export function PartnerVerificationPanel({
  kind,
  id,
  name,
  onClose,
  onVerified,
}: {
  kind: Kind
  id: string
  name: string
  onClose: () => void
  onVerified: () => Promise<void>
}) {
  const required = kind === 'vendor' ? VENDOR_VERIFICATION_CHECKS : RIDER_VERIFICATION_CHECKS
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [fields, setFields] = useState<Record<string, string>>(kind === 'vendor'
    ? { official_latitude: '', official_longitude: '', storefront_photo_url: '', reason: '' }
    : { nin: '', id_photo_url: '', live_selfie_url: '', guarantor_name: '', guarantor_phone: '+234', vehicle_type: 'bike', vehicle_photo_url: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const allChecked = useMemo(() => required.every((key) => checks[key]), [checks, required])

  function setField(key: string, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
    setError('')
  }

  async function submit() {
    if (!allChecked) {
      setError('Complete every required check before marking this partner verified.')
      return
    }
    setBusy(true)
    const body: Record<string, unknown> = { action: 'verify', checks, reason: fields.reason }
    if (kind === 'vendor') {
      body.official_latitude = Number(fields.official_latitude)
      body.official_longitude = Number(fields.official_longitude)
      body.storefront_photo_url = fields.storefront_photo_url
    } else {
      Object.assign(body, {
        nin: fields.nin,
        id_photo_url: fields.id_photo_url,
        live_selfie_url: fields.live_selfie_url,
        guarantor_name: fields.guarantor_name,
        guarantor_phone: fields.guarantor_phone,
        vehicle_type: fields.vehicle_type,
        vehicle_photo_url: fields.vehicle_photo_url,
      })
    }
    const response = await fetch(`/api/admin/${kind}s/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      setError(payload.error ?? 'Verification could not be saved.')
      setBusy(false)
      return
    }
    await onVerified()
    setBusy(false)
    onClose()
  }

  const inputClass = 'lx-field w-full px-3 py-3 text-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <section className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#111113] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Inspection and verification</p>
            <h2 className="mt-1 text-xl font-semibold">{name}</h2>
            <p className="mt-1 text-xs text-white/50">Verification records evidence. Final approval is a separate super-admin decision.</p>
          </div>
          <button onClick={onClose} className="h-11 w-11 shrink-0 rounded-full border border-white/10" aria-label="Close">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid gap-2">
            {required.map((key) => (
              <label key={key} className="flex min-h-12 items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
                <input type="checkbox" checked={!!checks[key]} onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 h-5 w-5 accent-amber-400" />
                <span>{LABELS[key] ?? key}</span>
              </label>
            ))}
          </div>

          {kind === 'vendor' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputClass} value={fields.official_latitude} onChange={(e) => setField('official_latitude', e.target.value)} placeholder="Official latitude" inputMode="decimal" />
              <input className={inputClass} value={fields.official_longitude} onChange={(e) => setField('official_longitude', e.target.value)} placeholder="Official longitude" inputMode="decimal" />
              <input className={`${inputClass} sm:col-span-2`} value={fields.storefront_photo_url} onChange={(e) => setField('storefront_photo_url', e.target.value)} placeholder="Storefront inspection photo URL" type="url" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputClass} value={fields.nin} onChange={(e) => setField('nin', e.target.value)} placeholder="NIN" />
              <select className={inputClass} value={fields.vehicle_type} onChange={(e) => setField('vehicle_type', e.target.value)}><option value="bike">Motorcycle</option><option value="bicycle">Bicycle</option><option value="foot">On foot</option></select>
              <input className={inputClass} value={fields.id_photo_url} onChange={(e) => setField('id_photo_url', e.target.value)} placeholder="Government ID photo URL" type="url" />
              <input className={inputClass} value={fields.live_selfie_url} onChange={(e) => setField('live_selfie_url', e.target.value)} placeholder="Live inspection selfie URL" type="url" />
              <input className={inputClass} value={fields.guarantor_name} onChange={(e) => setField('guarantor_name', e.target.value)} placeholder="Confirmed guarantor name" />
              <input className={inputClass} value={fields.guarantor_phone} onChange={(e) => setField('guarantor_phone', e.target.value)} placeholder="Guarantor phone" />
              <input className={`${inputClass} sm:col-span-2`} value={fields.vehicle_photo_url} onChange={(e) => setField('vehicle_photo_url', e.target.value)} placeholder="Inspection vehicle/equipment photo URL" type="url" />
            </div>
          )}

          <textarea className={`${inputClass} min-h-24 resize-y`} value={fields.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="Inspection notes, document expiry dates, exceptions, and follow-up actions" maxLength={500} />
          {error && <p className="rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        </div>

        <footer className="shrink-0 border-t border-white/10 bg-[#111113] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button onClick={submit} disabled={busy || !allChecked} className="lx-btn-amber min-h-13 w-full disabled:opacity-50">{busy ? 'Saving verification…' : 'Mark verified (still inactive)'}</button>
        </footer>
      </section>
    </div>
  )
}
