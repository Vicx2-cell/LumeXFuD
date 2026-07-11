import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getPremiumStatus, loadPremiumConfig, loadPremiumPlans, resolvePremiumFallbackPolicy } from '@/lib/premium'

const entitlementValue = z.union([z.boolean(), z.number(), z.string(), z.null()])
const benefitMap = z.record(z.string(), z.boolean()).default({})

const planInput = z.object({
  plan_key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  monthly_price_kobo: z.number().int().min(0),
  yearly_price_kobo: z.number().int().min(0),
  currency: z.string().trim().min(3).max(8).default('NGN'),
  trial_duration_days: z.number().int().min(0).max(3650).default(0),
  grace_period_days: z.number().int().min(0).max(3650).default(0),
  audience: z.enum(['customer', 'vendor', 'rider', 'admin', 'all']).default('vendor'),
  included_benefits: benefitMap,
  display_order: z.number().int().min(0).max(1000).default(0),
  paystack_plan_reference: z.string().trim().max(120).nullable().optional(),
  is_active: z.boolean().default(true),
  effective_from: z.string().datetime({ offset: true }).nullable().optional(),
  change_summary: z.string().trim().max(500).nullable().optional(),
})

const configInput = z.object({
  premiumEnabled: z.boolean().optional(),
  newSubscriptionsEnabled: z.boolean().optional(),
  trialsEnabled: z.boolean().optional(),
  premiumUIVisible: z.boolean().optional(),
  preserveExistingUntilExpiry: z.boolean().optional(),
  immediateDisableExistingBenefits: z.boolean().optional(),
  premiumFallbackPolicy: z.enum(['deny_all_premium_features', 'grant_all_premium_features', 'preserve_existing_until_expiry']).optional(),
  reason: z.string().trim().max(500).optional(),
})

const overrideInput = z.object({
  profile_id: z.string().trim().min(1).max(120),
  entitlement_key: z.string().trim().min(1).max(120),
  override_type: z.enum(['grant', 'deny', 'value']),
  entitlement_value: entitlementValue.optional(),
  starts_at: z.string().datetime({ offset: true }).optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
})

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

async function writePremiumAudit(db: ReturnType<typeof createSupabaseAdmin>, payload: Record<string, unknown>) {
  await db.from('premium_audit_log').insert(payload)
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if ('error' in auth) return auth.error

  const db = createSupabaseAdmin()
  const profileId = req.nextUrl.searchParams.get('profile_id')
  const [plans, config, auditRes, inspected] = await Promise.all([
    loadPremiumPlans(),
    loadPremiumConfig(),
    db.from('premium_audit_log').select('*').order('created_at', { ascending: false }).limit(25),
    profileId ? getPremiumStatus(profileId).catch(() => null) : Promise.resolve(null),
  ])

  return NextResponse.json({
    ok: true,
    plans,
    config,
    audit: auditRes.data ?? [],
    inspected,
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if ('error' in auth) return auth.error
  const rl = await rateLimitGeneric(`super-premium:${auth.session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const rawAction = z.object({ action: z.string().optional() }).safeParse(body).success
    ? (body as { action?: string }).action
    : undefined
  const db = createSupabaseAdmin()

  if (rawAction === 'set_config') {
    const parsed = configInput.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid config payload' }, { status: 400 })
    const current = await db.from('premium_config').select('*').eq('config_key', 'global').maybeSingle()
    const nextPolicy = parsed.data.premiumFallbackPolicy ?? (current.data as { premium_fallback_policy?: string } | null)?.premium_fallback_policy ?? 'preserve_existing_until_expiry'
    const payload = {
      config_key: 'global',
      premium_enabled: parsed.data.premiumEnabled ?? (current.data as { premium_enabled?: boolean } | null)?.premium_enabled ?? false,
      new_subscriptions_enabled: parsed.data.newSubscriptionsEnabled ?? (current.data as { new_subscriptions_enabled?: boolean } | null)?.new_subscriptions_enabled ?? false,
      trials_enabled: parsed.data.trialsEnabled ?? (current.data as { trials_enabled?: boolean } | null)?.trials_enabled ?? false,
      premium_ui_visible: parsed.data.premiumUIVisible ?? (current.data as { premium_ui_visible?: boolean } | null)?.premium_ui_visible ?? true,
      preserve_existing_until_expiry: parsed.data.preserveExistingUntilExpiry ?? (current.data as { preserve_existing_until_expiry?: boolean } | null)?.preserve_existing_until_expiry ?? true,
      immediate_disable_existing_benefits: parsed.data.immediateDisableExistingBenefits ?? (current.data as { immediate_disable_existing_benefits?: boolean } | null)?.immediate_disable_existing_benefits ?? false,
      premium_fallback_policy: nextPolicy,
      updated_by: auth.session.phone,
      reason: parsed.data.reason ?? null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('premium_config').upsert(payload, { onConflict: 'config_key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writePremiumAudit(db, {
      actor: auth.session.phone,
      actor_role: auth.session.role,
      action: 'premium_config_update',
      target_type: 'premium_config',
      target_id: 'global',
      old_value: current.data ?? undefined,
      new_value: payload,
      reason: parsed.data.reason ?? null,
      version: 1,
      metadata: { action: 'set_config' },
    })
    await superAudit({
      actor_id: auth.session.phone,
      actor_role: auth.session.role,
      action: 'premium_config_update',
      target_table: 'premium_config',
      target_id: 'global',
      old_value: (current.data as Record<string, unknown>) ?? undefined,
      new_value: payload,
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return NextResponse.json({ ok: true })
  }

  if (rawAction === 'grant_override' || rawAction === 'revoke_override') {
    const parsed = overrideInput.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid override payload' }, { status: 400 })

    if (rawAction === 'grant_override') {
      const payload = {
        profile_id: parsed.data.profile_id,
        entitlement_key: parsed.data.entitlement_key,
        override_type: parsed.data.override_type,
        entitlement_value: parsed.data.entitlement_value ?? (parsed.data.override_type === 'value' ? null : parsed.data.override_type === 'grant'),
        starts_at: parsed.data.starts_at ?? new Date().toISOString(),
        ends_at: parsed.data.ends_at ?? null,
        actor: auth.session.phone,
        reason: parsed.data.reason ?? null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await db.from('entitlement_overrides').insert(payload)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      await writePremiumAudit(db, {
        actor: auth.session.phone,
        actor_role: auth.session.role,
        action: 'entitlement_override_grant',
        target_type: 'entitlement_overrides',
        target_id: `${parsed.data.profile_id}:${parsed.data.entitlement_key}`,
        new_value: payload,
        reason: parsed.data.reason ?? null,
        version: 1,
        metadata: { override_type: parsed.data.override_type },
      })
      return NextResponse.json({ ok: true })
    }

    const { error } = await db
      .from('entitlement_overrides')
      .update({ revoked_at: new Date().toISOString(), revoked_by: auth.session.phone, updated_at: new Date().toISOString() })
      .eq('profile_id', parsed.data.profile_id)
      .eq('entitlement_key', parsed.data.entitlement_key)
      .is('revoked_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writePremiumAudit(db, {
      actor: auth.session.phone,
      actor_role: auth.session.role,
      action: 'entitlement_override_revoke',
      target_type: 'entitlement_overrides',
      target_id: `${parsed.data.profile_id}:${parsed.data.entitlement_key}`,
      new_value: { revoked_at: new Date().toISOString(), revoked_by: auth.session.phone },
      reason: parsed.data.reason ?? null,
      version: 1,
      metadata: {},
    })
    return NextResponse.json({ ok: true })
  }

  const parsed = planInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid plan payload' }, { status: 400 })

  const current = await db.from('premium_plans').select('id, version, included_benefits, is_active, monthly_price_kobo, yearly_price_kobo, trial_duration_days, grace_period_days, audience, display_order, description, name, currency, paystack_plan_reference, effective_from').eq('plan_key', parsed.data.plan_key).maybeSingle()
  const existing = current.data as Record<string, unknown> | null
  const nextVersion = Number(existing?.version ?? 0) + 1

  const payload = {
    plan_key: parsed.data.plan_key,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    monthly_price_kobo: parsed.data.monthly_price_kobo,
    yearly_price_kobo: parsed.data.yearly_price_kobo,
    currency: parsed.data.currency,
    trial_duration_days: parsed.data.trial_duration_days,
    grace_period_days: parsed.data.grace_period_days,
    audience: parsed.data.audience,
    included_benefits: parsed.data.included_benefits,
    display_order: parsed.data.display_order,
    paystack_plan_reference: parsed.data.paystack_plan_reference ?? null,
    version: nextVersion,
    effective_from: parsed.data.effective_from ?? null,
    is_active: parsed.data.is_active,
    updated_at: new Date().toISOString(),
  }

  const { error: upsertError } = await db.from('premium_plans').upsert(payload, { onConflict: 'plan_key' })
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 400 })

  const insertedPlan = await db.from('premium_plans').select('id').eq('plan_key', parsed.data.plan_key).maybeSingle()
  const versionPayload = {
    premium_plan_id: existing?.id ?? insertedPlan.data?.id,
    version: nextVersion,
    change_summary: parsed.data.change_summary ?? 'Updated premium plan',
    monthly_price_kobo: parsed.data.monthly_price_kobo,
    yearly_price_kobo: parsed.data.yearly_price_kobo,
    trial_duration_days: parsed.data.trial_duration_days,
    grace_period_days: parsed.data.grace_period_days,
    currency: parsed.data.currency,
    audience: parsed.data.audience,
    included_entitlements: parsed.data.included_benefits,
    entitlement_values: Object.fromEntries(Object.entries(parsed.data.included_benefits).map(([key, enabled]) => [key, enabled])),
    display_metadata: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      display_order: parsed.data.display_order,
      effective_from: parsed.data.effective_from ?? null,
      is_active: parsed.data.is_active,
    },
    effective_from: parsed.data.effective_from ?? null,
    is_active: parsed.data.is_active,
    created_by: auth.session.phone,
    reason: parsed.data.change_summary ?? 'Updated premium plan',
  }
  const { error: versionError } = await db.from('plan_versions').insert(versionPayload)
  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 400 })

  await writePremiumAudit(db, {
    actor: auth.session.phone,
    actor_role: auth.session.role,
    action: 'premium_plan_update',
    target_type: 'premium_plans',
    target_id: String(existing?.id ?? parsed.data.plan_key),
    old_value: existing ?? undefined,
    new_value: payload,
    reason: parsed.data.change_summary ?? null,
    version: nextVersion,
    metadata: { fallback_policy: await resolvePremiumFallbackPolicy() },
  })

  await superAudit({
    actor_id: auth.session.phone,
    actor_role: auth.session.role,
    action: 'premium_plan_update',
    target_table: 'premium_plans',
    target_id: String(existing?.id ?? parsed.data.plan_key),
    old_value: existing ?? undefined,
    new_value: payload,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ ok: true })
}
