'use client'

import { FormEvent, useState } from 'react'

const intents = [
  ['general', 'General enquiry'], ['support', 'Order, payment or account support'], ['complaint', 'Complaint'], ['refund', 'Refund or dispute'],
  ['partnership', 'Partnership'], ['sponsorship', 'Sponsorship'], ['security', 'Security report'], ['fraud', 'Fraud report'],
  ['press', 'Press or media'], ['privacy', 'Privacy request'], ['deletion', 'Data deletion'], ['legal', 'Legal notice'],
] as const

type Intent = (typeof intents)[number][0]

type ContactFormProps = {
  defaultIntent?: Intent
  hideIntent?: boolean
  defaultName?: string
  defaultEmail?: string
  defaultSubject?: string
  defaultReference?: string
  submitLabel?: string
}

export function ContactForm({
  defaultIntent = 'support',
  hideIntent = false,
  defaultName = '',
  defaultEmail = '',
  defaultSubject = '',
  defaultReference = '',
  submitLabel = 'Send request',
}: ContactFormProps = {}) {
  const [state, setState] = useState<{ loading: boolean; error: string; reference: string; acknowledgement: string }>({ loading: false, error: '', reference: '', acknowledgement: '' })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    setState({ loading: true, error: '', reference: '', acknowledgement: '' })
    const form = new FormData(formElement)
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) })
      const data = await response.json() as { error?: string; reference?: string; acknowledgementStatus?: string }
      if (!response.ok || !data.reference) throw new Error(data.error ?? 'Could not save your request.')
      setState({ loading: false, error: '', reference: data.reference, acknowledgement: data.acknowledgementStatus ?? 'skipped' })
      formElement.reset()
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : 'Network error. Please try again.', reference: '', acknowledgement: '' })
    }
  }

  if (state.reference) return <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5"><p className="font-semibold text-white">Request saved</p><p className="mt-2 text-sm text-white/70">Reference: <strong>{state.reference}</strong></p><p className="mt-2 text-sm text-white/55">{state.acknowledgement === 'sent' ? 'We also sent an email acknowledgement.' : 'Your request is safely queued, but the acknowledgement email was not confirmed. Keep this reference.'}</p></div>

  return <form onSubmit={submit} className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5">
    {hideIntent ? (
      <input name="intent" type="hidden" defaultValue={defaultIntent} />
    ) : (
      <label className="block text-sm text-white/75">What do you need help with?<select name="intent" defaultValue={defaultIntent} required className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#111113] px-3 text-white">{intents.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    )}
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-white/75">Name<input name="name" defaultValue={defaultName} required minLength={2} maxLength={100} autoComplete="name" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#111113] px-3 text-white" /></label><label className="block text-sm text-white/75">Email<input name="email" defaultValue={defaultEmail} required type="email" maxLength={254} autoComplete="email" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#111113] px-3 text-white" /></label></div>
    <label className="block text-sm text-white/75">Subject<input name="subject" defaultValue={defaultSubject} required minLength={4} maxLength={140} className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#111113] px-3 text-white" /></label>
    <label className="block text-sm text-white/75">Order or application reference (if relevant)<input name="relatedReference" defaultValue={defaultReference} maxLength={80} className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#111113] px-3 text-white" /></label>
    <label className="block text-sm text-white/75">Message<textarea name="message" required minLength={20} maxLength={5000} rows={6} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111113] p-3 text-white" /></label>
    <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
    {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
    <button disabled={state.loading} className="min-h-12 rounded-xl bg-[#F5A623] px-5 font-semibold text-black disabled:opacity-60">{state.loading ? 'Saving…' : submitLabel}</button>
  </form>
}
