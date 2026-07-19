import crypto from 'crypto'
import { createSupabaseAdmin } from '../supabase/server'
import { initializePaystackTransaction, verifyPaystackTransaction } from './init'
import { loadPremiumPlans, loadPremiumConfig } from '../premium'
import { getFeature } from '../features'

export type BillingCycle = 'monthly' | 'yearly'
export type BillingDomain = 'premium' | 'boost'

export interface PremiumBillingInitInput {
  profileId: string
  planKey: string
  billingCycle: BillingCycle
  actor: string
}

export interface BoostBillingInitInput {
  vendorId: string
  postId: string
  boostPackageKey: string
  actor: string
  targetCityId?: string | null
  targetZoneId?: string | null
}

export interface BillingInitResult {
  authorization_url: string
  access_code: string
  reference: string
  amount_kobo: number
}

function shortRef(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`
}

async function insertLedgerRow(payload: {
  billing_domain: BillingDomain
  payment_event_id: string
  payment_reference: string
  entry_type: 'initialized' | 'verified' | 'activated' | 'failed' | 'renewed' | 'expired' | 'canceled' | 'refunded'
  amount_kobo: number
  actor?: string
  actor_role?: string
  reason?: string | null
  metadata?: Record<string, unknown>
}) {
  const db = createSupabaseAdmin()
  await db.from('billing_ledger_entries').insert({
    billing_domain: payload.billing_domain,
    payment_event_id: payload.payment_event_id,
    payment_reference: payload.payment_reference,
    entry_type: payload.entry_type,
    amount_kobo: payload.amount_kobo,
    currency: 'NGN',
    actor: payload.actor ?? null,
    actor_role: payload.actor_role ?? null,
    reason: payload.reason ?? null,
    metadata: payload.metadata ?? {},
  })
}

export async function initializePremiumBilling(input: PremiumBillingInitInput): Promise<BillingInitResult> {
  const db = createSupabaseAdmin()
  const config = await loadPremiumConfig()
  if (!config.premiumEnabled || !config.newSubscriptionsEnabled) {
    throw new Error('Premium billing is not enabled')
  }

  const plans = await loadPremiumPlans()
  const plan = plans.find((item) => item.plan_key === input.planKey && item.is_active)
  if (!plan) throw new Error('Premium plan not found')
  if (plan.audience !== 'vendor' && plan.audience !== 'all') {
    throw new Error('Plan is not available for vendors')
  }

  const { data: existingEvent } = await db
    .from('premium_payment_events')
    .select('paystack_reference, provider_response, amount_kobo, metadata, status')
    .eq('profile_id', input.profileId)
    .maybeSingle()
  if (existingEvent) {
    const metadata = (existingEvent as { metadata?: Record<string, unknown> }).metadata ?? {}
    if (String(metadata.plan_key ?? '') === input.planKey && String(metadata.billing_cycle ?? '') === input.billingCycle) {
      const response = (existingEvent as { provider_response?: Record<string, unknown> }).provider_response ?? {}
      if (typeof response.authorization_url === 'string' && typeof response.access_code === 'string' && typeof response.reference === 'string') {
        return {
          authorization_url: response.authorization_url,
          access_code: response.access_code,
          reference: response.reference,
          amount_kobo: Number((existingEvent as { amount_kobo?: number }).amount_kobo ?? 0),
        }
      }
    }
  }

  const amountKobo = input.billingCycle === 'yearly' ? plan.yearly_price_kobo : plan.monthly_price_kobo
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) throw new Error('Plan price is not configured')

  const reference = shortRef('PREM')
  const { error: insertError } = await db.from('premium_payment_events').insert({
    profile_id: input.profileId,
    premium_plan_id: plan.id,
    premium_plan_version_id: null,
    paystack_reference: reference,
    billing_cycle: input.billingCycle,
    amount_kobo: amountKobo,
    currency: plan.currency ?? 'NGN',
    status: 'initialized',
    provider_response: {},
    webhook_payload: {},
    metadata: { plan_key: plan.plan_key, plan_version: plan.version, billing_cycle: input.billingCycle },
    created_by: input.actor,
  })
  if (insertError) throw new Error(insertError.message)
  const inserted = await db.from('premium_payment_events').select('id').eq('paystack_reference', reference).maybeSingle()

  await insertLedgerRow({
    billing_domain: 'premium',
    payment_event_id: String(inserted.data?.id ?? reference),
    payment_reference: reference,
    entry_type: 'initialized',
    amount_kobo: amountKobo,
    actor: input.actor,
    reason: 'Premium checkout initialized',
    metadata: { plan_key: plan.plan_key, billing_cycle: input.billingCycle },
  })

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'}/premium?checkout=${encodeURIComponent(reference)}`
  const init = await initializePaystackTransaction({
    email: `${input.profileId}@lumex.fud`,
    amount: amountKobo,
    reference,
    callback_url: callbackUrl,
    metadata: {
      type: 'PREMIUM_SUBSCRIPTION',
      profile_id: input.profileId,
      plan_key: plan.plan_key,
      plan_version: plan.version,
      billing_cycle: input.billingCycle,
      payment_event_id: String(inserted.data?.id ?? reference),
    },
  })

  await db.from('premium_payment_events').update({
    provider_response: init,
    updated_at: new Date().toISOString(),
  }).eq('paystack_reference', reference)
  await recordBillingDiagnostics('premium', 'initialize', reference, 'initialized', amountKobo, {
    plan_key: plan.plan_key,
    billing_cycle: input.billingCycle,
    actor: input.actor,
  })

  return { ...init, amount_kobo: amountKobo }
}

export async function initializeBoostBilling(input: BoostBillingInitInput): Promise<BillingInitResult> {
  const db = createSupabaseAdmin()
  const featureEnabled = await getFeature('post_boosts_enabled')
  if (!featureEnabled) throw new Error('Post boosts are disabled')

  const { data: post } = await db.from('posts').select('id, author_profile_id, deleted_at, is_archived, status').eq('id', input.postId).maybeSingle()
  if (!post) throw new Error('Post not found')
  if (String((post as { author_profile_id?: string }).author_profile_id ?? '') !== input.vendorId) throw new Error('Post does not belong to this vendor')
  if ((post as { deleted_at?: string | null }).deleted_at || (post as { is_archived?: boolean }).is_archived || String((post as { status?: string }).status ?? '') === 'deleted') {
    throw new Error('Post is not eligible for boosting')
  }

  const { data: packageRow } = await db.from('boost_packages').select('id, package_key, name, duration_days, budget_kobo, geographic_radius_km, max_uplift, is_active').eq('package_key', input.boostPackageKey).maybeSingle()
  if (!packageRow) throw new Error('Boost package not found')
  if (!(packageRow as { is_active?: boolean }).is_active) throw new Error('Boost package is inactive')

  const amountKobo = Number((packageRow as { budget_kobo?: number }).budget_kobo ?? 0)
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) throw new Error('Boost package price is not configured')

  const campaignInsert = await db.from('boost_campaigns').insert({
    vendor_id: input.vendorId,
    post_id: input.postId,
    boost_package_id: String((packageRow as { id: string }).id),
    target_city_id: input.targetCityId ?? null,
    target_zone_id: input.targetZoneId ?? null,
    budget_kobo: amountKobo,
    spend_kobo: 0,
    estimated_reach_min: 0,
    estimated_reach_max: 0,
    status: 'pending_payment',
    approval_state: 'not_submitted',
    starts_at: null,
    ends_at: null,
  }).select('id').single()
  if (campaignInsert.error) throw new Error(campaignInsert.error.message)

  const reference = shortRef('BOST')
  const { error: insertError } = await db.from('boost_payment_events').insert({
    vendor_id: input.vendorId,
    post_id: input.postId,
    boost_campaign_id: campaignInsert.data.id,
    boost_package_id: String((packageRow as { id: string }).id),
    paystack_reference: reference,
    amount_kobo: amountKobo,
    currency: 'NGN',
    status: 'initialized',
    provider_response: {},
    webhook_payload: {},
    metadata: { boost_package_key: input.boostPackageKey, target_city_id: input.targetCityId ?? null, target_zone_id: input.targetZoneId ?? null },
    created_by: input.actor,
  })
  if (insertError) throw new Error(insertError.message)
  const inserted = await db.from('boost_payment_events').select('id').eq('paystack_reference', reference).maybeSingle()

  await insertLedgerRow({
    billing_domain: 'boost',
    payment_event_id: String(inserted.data?.id ?? reference),
    payment_reference: reference,
    entry_type: 'initialized',
    amount_kobo: amountKobo,
    actor: input.actor,
    reason: 'Boost checkout initialized',
    metadata: { post_id: input.postId, boost_package_key: input.boostPackageKey },
  })

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'}/vendor-dashboard/boosts?checkout=${encodeURIComponent(reference)}`
  const init = await initializePaystackTransaction({
    email: `${input.vendorId}@lumex.fud`,
    amount: amountKobo,
    reference,
    callback_url: callbackUrl,
    metadata: {
      type: 'BOOST_PURCHASE',
      vendor_id: input.vendorId,
      post_id: input.postId,
      boost_campaign_id: campaignInsert.data.id,
      boost_package_key: input.boostPackageKey,
      payment_event_id: String(inserted.data?.id ?? reference),
    },
  })

  await db.from('boost_payment_events').update({
    provider_response: init,
    updated_at: new Date().toISOString(),
  }).eq('paystack_reference', reference)
  await recordBillingDiagnostics('boost', 'initialize', reference, 'initialized', amountKobo, {
    boost_package_key: input.boostPackageKey,
    post_id: input.postId,
    actor: input.actor,
  })

  return { ...init, amount_kobo: amountKobo }
}

async function findPremiumEvent(reference: string) {
  const db = createSupabaseAdmin()
  const { data } = await db.from('premium_payment_events').select('*').eq('paystack_reference', reference).maybeSingle()
  return data ? (data as Record<string, unknown>) : null
}

async function findBoostEvent(reference: string) {
  const db = createSupabaseAdmin()
  const { data } = await db.from('boost_payment_events').select('*').eq('paystack_reference', reference).maybeSingle()
  return data ? (data as Record<string, unknown>) : null
}

async function activatePremiumFromEvent(reference: string, metadata: Record<string, unknown>, verifiedAmount: number) {
  const db = createSupabaseAdmin()
  const event = await findPremiumEvent(reference)
  if (!event) return
  const profileId = String(event.profile_id ?? metadata.profile_id ?? '')
  if (!profileId) return

  const { data: plan } = await db.from('premium_plans').select('id, plan_key, monthly_price_kobo, yearly_price_kobo, currency, trial_duration_days, grace_period_days, version, included_benefits').eq('plan_key', String(metadata.plan_key ?? '')).maybeSingle()
  if (!plan) return

  const billingCycle = String(metadata.billing_cycle ?? 'monthly') as BillingCycle
  const priceKobo = billingCycle === 'yearly' ? Number((plan as { yearly_price_kobo?: number }).yearly_price_kobo ?? 0) : Number((plan as { monthly_price_kobo?: number }).monthly_price_kobo ?? 0)
  const durationMs = billingCycle === 'yearly' ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
  const now = new Date()

  const { data: latest } = await db.from('user_subscriptions').select('*').eq('profile_id', profileId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const periodStart = latest && typeof (latest as { period_ends_at?: string | null }).period_ends_at === 'string' && new Date((latest as { period_ends_at: string }).period_ends_at).getTime() > now.getTime()
    ? new Date((latest as { period_ends_at: string }).period_ends_at)
    : now
  const periodEnd = new Date(periodStart.getTime() + durationMs)
  const graceEnd = new Date(periodEnd.getTime() + Number((plan as { grace_period_days?: number }).grace_period_days ?? 0) * 86_400_000)

  const entitlementSnapshot = Object.fromEntries(Object.entries((plan as { included_benefits?: Record<string, boolean> }).included_benefits ?? {}).map(([k, v]) => [k, v])) as Record<string, boolean>
  const subscriptionPayload = {
    profile_id: profileId,
    premium_plan_id: String((plan as { id: string }).id),
    premium_plan_version_id: null,
    state: 'active',
    started_at: now.toISOString(),
    trial_ends_at: null,
    period_starts_at: periodStart.toISOString(),
    period_ends_at: periodEnd.toISOString(),
    grace_ends_at: graceEnd.toISOString(),
    canceled_at: null,
    paused_at: null,
    manually_granted_at: null,
    manually_revoked_at: null,
    price_kobo: priceKobo,
    currency: String((plan as { currency?: string }).currency ?? 'NGN'),
    entitlement_snapshot: entitlementSnapshot,
    metadata: { paystack_reference: reference, billing_cycle: billingCycle },
    created_by: String(metadata.actor ?? metadata.vendor_id ?? profileId),
    updated_by: String(metadata.actor ?? metadata.vendor_id ?? profileId),
    reason: 'Paystack premium payment verified',
    updated_at: now.toISOString(),
  }

  if (latest?.id) {
    await db.from('user_subscriptions').update(subscriptionPayload).eq('id', latest.id)
  } else {
    await db.from('user_subscriptions').insert(subscriptionPayload)
  }

  await db.from('premium_payment_events').update({
    premium_plan_id: String((plan as { id: string }).id),
    premium_plan_version_id: null,
    status: 'active',
    verified_at: now.toISOString(),
    activated_at: now.toISOString(),
    webhook_payload: metadata,
    provider_response: { verified_amount: verifiedAmount },
    updated_at: now.toISOString(),
  }).eq('paystack_reference', reference)

  const paymentEvent = await findPremiumEvent(reference)
  if (paymentEvent?.id) {
    await insertLedgerRow({
      billing_domain: 'premium',
      payment_event_id: String(paymentEvent.id),
      payment_reference: reference,
      entry_type: 'activated',
      amount_kobo: verifiedAmount,
      actor: String(metadata.actor ?? profileId),
      reason: 'Premium subscription activated',
      metadata: { plan_key: metadata.plan_key, billing_cycle: billingCycle },
    })
  }
}

async function failPremiumFromEvent(reference: string, metadata: Record<string, unknown>, reason: string) {
  const db = createSupabaseAdmin()
  const event = await findPremiumEvent(reference)
  if (!event) return
  const profileId = String(event.profile_id ?? metadata.profile_id ?? '')
  const now = new Date().toISOString()
  await db.from('premium_payment_events').update({
    status: 'failed',
    failed_at: now,
    failed_reason: reason,
    webhook_payload: metadata,
    updated_at: now,
  }).eq('paystack_reference', reference)
  if (profileId) {
    await db.from('user_subscriptions').update({
      state: 'past_due',
      grace_ends_at: now,
      updated_at: now,
      reason,
    }).eq('profile_id', profileId).eq('state', 'active')
  }
  if (event?.id) {
    await insertLedgerRow({
      billing_domain: 'premium',
      payment_event_id: String(event.id),
      payment_reference: reference,
      entry_type: 'failed',
      amount_kobo: Number(event.amount_kobo ?? 0),
      actor: String(metadata.actor ?? profileId ?? ''),
      reason,
      metadata,
    })
  }
}

async function activateBoostFromEvent(reference: string, metadata: Record<string, unknown>, verifiedAmount: number) {
  const db = createSupabaseAdmin()
  const event = await findBoostEvent(reference)
  if (!event) return
  const now = new Date().toISOString()
  const campaignId = String(event.boost_campaign_id ?? metadata.boost_campaign_id ?? '')
  if (!campaignId) return

  const { data: campaign } = await db.from('boost_campaigns').select('id, boost_package_id, budget_kobo').eq('id', campaignId).maybeSingle()
  if (!campaign) return
  const packageId = String((campaign as { boost_package_id?: string | null }).boost_package_id ?? '')
  const { data: pkg } = await db.from('boost_packages').select('id, duration_days').eq('id', packageId).maybeSingle()
  const durationDays = Number((pkg as { duration_days?: number } | undefined)?.duration_days ?? 1)
  const endsAt = new Date(Date.now() + durationDays * 86_400_000).toISOString()

  await db.from('boost_campaigns').update({
    status: 'active',
    approval_state: 'approved',
    starts_at: now,
    ends_at: endsAt,
    updated_at: now,
  }).eq('id', campaignId)

  await db.from('boost_payment_events').update({
    status: 'active',
    verified_at: now,
    activated_at: now,
    webhook_payload: metadata,
    provider_response: { verified_amount: verifiedAmount },
    updated_at: now,
  }).eq('paystack_reference', reference)

  if (event?.id) {
    await insertLedgerRow({
      billing_domain: 'boost',
      payment_event_id: String(event.id),
      payment_reference: reference,
      entry_type: 'activated',
      amount_kobo: verifiedAmount,
      actor: String(metadata.actor ?? metadata.vendor_id ?? ''),
      reason: 'Boost campaign activated',
      metadata: { boost_campaign_id: campaignId, post_id: metadata.post_id },
    })
  }
}

async function failBoostFromEvent(reference: string, metadata: Record<string, unknown>, reason: string) {
  const db = createSupabaseAdmin()
  const event = await findBoostEvent(reference)
  if (!event) return
  const campaignId = String(event.boost_campaign_id ?? metadata.boost_campaign_id ?? '')
  const now = new Date().toISOString()
  await db.from('boost_payment_events').update({
    status: 'failed',
    failed_at: now,
    failed_reason: reason,
    webhook_payload: metadata,
    updated_at: now,
  }).eq('paystack_reference', reference)
  if (campaignId) {
    await db.from('boost_campaigns').update({
      status: 'cancelled',
      updated_at: now,
    }).eq('id', campaignId)
  }
  if (event?.id) {
    await insertLedgerRow({
      billing_domain: 'boost',
      payment_event_id: String(event.id),
      payment_reference: reference,
      entry_type: 'failed',
      amount_kobo: Number(event.amount_kobo ?? 0),
      actor: String(metadata.actor ?? metadata.vendor_id ?? ''),
      reason,
      metadata,
    })
  }
}

export async function processPremiumOrBoostWebhook(event: 'charge.success' | 'charge.failed', data: Record<string, unknown>) {
  const metadata = (data.metadata as Record<string, unknown>) ?? {}
  const reference = String(data.reference ?? '')
  if (!reference) return

  if ((metadata.type as string) === 'PREMIUM_SUBSCRIPTION') {
    if (event === 'charge.success') {
      let verifiedAmount = Number(data.amount ?? 0)
      try {
        const verified = await verifyPaystackTransaction(reference)
        if (verified.status !== 'success') return
        verifiedAmount = Number(verified.amount)
      } catch {
        // fall back to authenticated webhook amount when Paystack verification is temporarily unavailable
      }
      await recordBillingDiagnostics('premium', event, reference, 'verified', verifiedAmount, { metadata })
      await activatePremiumFromEvent(reference, metadata, verifiedAmount)
      return
    }
    await recordBillingDiagnostics('premium', event, reference, 'failed', Number(data.amount ?? 0), { metadata })
    await failPremiumFromEvent(reference, metadata, String(data.gateway_response ?? data.message ?? 'Payment failed'))
    return
  }

  if ((metadata.type as string) === 'BOOST_PURCHASE') {
    if (event === 'charge.success') {
      let verifiedAmount = Number(data.amount ?? 0)
      try {
        const verified = await verifyPaystackTransaction(reference)
        if (verified.status !== 'success') return
        verifiedAmount = Number(verified.amount)
      } catch {
        // fail soft; the signed webhook payload still tells us a successful charge occurred
      }
      await recordBillingDiagnostics('boost', event, reference, 'verified', verifiedAmount, { metadata })
      await activateBoostFromEvent(reference, metadata, verifiedAmount)
      return
    }
    await recordBillingDiagnostics('boost', event, reference, 'failed', Number(data.amount ?? 0), { metadata })
    await failBoostFromEvent(reference, metadata, String(data.gateway_response ?? data.message ?? 'Payment failed'))
  }
}

export async function recordBillingDiagnostics(domain: BillingDomain, eventType: string, reference: string, status: string, amountKobo: number, details: Record<string, unknown>) {
  const db = createSupabaseAdmin()
  await db.from('paystack_billing_diagnostics').insert({
    domain,
    event_type: eventType,
    reference,
    status,
    amount_kobo: amountKobo,
    currency: 'NGN',
    details,
  })
}
