import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser, type SessionRole } from './session'
import { getFeature, getAllFeatures } from './features'

export type PremiumFallbackPolicy =
  | 'deny_all_premium_features'
  | 'grant_all_premium_features'
  | 'preserve_existing_until_expiry'

export type PremiumSubscriptionState =
  | 'none'
  | 'trialing'
  | 'active'
  | 'grace_period'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'paused'
  | 'manually_granted'
  | 'manually_revoked'

export type PremiumEntitlementKey =
  | 'premium.tiktok.connect'
  | 'premium.tiktok.video_limit'
  | 'premium.video.active_limit'
  | 'premium.video.unlimited'
  | 'premium.feed.visibility_boost'
  | 'premium.analytics.advanced'
  | 'premium.posts.schedule'
  | 'premium.posts.pin'
  | 'premium.badge'
  | 'premium.menu.multiple_tags'
  | 'premium.templates'
  | 'premium.support.priority'
  | 'premium.boost.discount_percent'

export type PremiumEntitlementValue = boolean | number | string | null

export type PremiumEntitlementState = Record<PremiumEntitlementKey, PremiumEntitlementValue>

export interface PremiumConfig {
  premiumEnabled: boolean
  newSubscriptionsEnabled: boolean
  trialsEnabled: boolean
  premiumUIVisible: boolean
  preserveExistingUntilExpiry: boolean
  immediateDisableExistingBenefits: boolean
  premiumFallbackPolicy: PremiumFallbackPolicy
  metadata: Record<string, unknown>
  updatedAt: string | null
  createdAt: string | null
}

export interface PremiumPlanRecord {
  id: string
  plan_key: string
  name: string
  description: string | null
  monthly_price_kobo: number
  yearly_price_kobo: number
  currency: string
  trial_duration_days: number
  grace_period_days: number
  audience: PremiumPlanAudience
  included_benefits: Record<string, boolean>
  display_order: number
  paystack_plan_reference: string | null
  version: number
  effective_from: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  latest_version: number | null
  latest_change_summary: string | null
  latest_entitlement_values: Record<string, PremiumEntitlementValue>
}

export type PremiumPlanAudience = 'customer' | 'vendor' | 'rider' | 'admin' | 'all'

export interface PremiumSubscriptionSnapshot {
  state: PremiumSubscriptionState
  planKey: string | null
  planVersion: number | null
  planVersionId: string | null
  planId: string | null
  startedAt: string | null
  trialEndsAt: string | null
  periodStartsAt: string | null
  periodEndsAt: string | null
  graceEndsAt: string | null
  canceledAt: string | null
  pausedAt: string | null
  manuallyGrantedAt: string | null
  manuallyRevokedAt: string | null
  priceKobo: number | null
  currency: string | null
  entitlementSnapshot: PremiumEntitlementState
  activeUntil: string | null
}

export interface PremiumStatus {
  premiumEnabled: boolean
  newSubscriptionsEnabled: boolean
  trialsEnabled: boolean
  premiumUIVisible: boolean
  premiumFallbackPolicy: PremiumFallbackPolicy
  role: SessionRole | null
  profileId: string | null
  hasPremium: boolean
  subscriptionState: PremiumSubscriptionState
  activePlanKey: string | null
  activePlanVersion: number | null
  renewalOrExpiryAt: string | null
  trialEndsAt: string | null
  graceEndsAt: string | null
  entitlementKeys: PremiumEntitlementKey[]
  entitlements: PremiumEntitlementState
  featureFlags: Record<string, boolean>
  benefits: Record<string, boolean>
  disabledReason: string | null
  effectivePlan: PremiumPlanRecord | null
  config: PremiumConfig
}

interface PremiumPlanVersionRow {
  id: string
  premium_plan_id: string
  version: number
  change_summary: string | null
  monthly_price_kobo: number | null
  yearly_price_kobo: number | null
  trial_duration_days: number | null
  grace_period_days: number | null
  currency: string | null
  audience: PremiumPlanAudience | null
  included_entitlements: Record<string, boolean> | null
  entitlement_values: Record<string, PremiumEntitlementValue> | null
  display_metadata: Record<string, unknown> | null
  effective_from: string | null
  effective_until: string | null
  is_active: boolean | null
  created_by: string | null
  reason: string | null
}

interface PremiumSubscriptionRow {
  id: string
  profile_id: string
  premium_plan_id: string | null
  premium_plan_version_id: string | null
  state: PremiumSubscriptionState | string
  started_at: string | null
  trial_ends_at: string | null
  period_starts_at: string | null
  period_ends_at: string | null
  grace_ends_at: string | null
  canceled_at: string | null
  paused_at: string | null
  manually_granted_at: string | null
  manually_revoked_at: string | null
  price_kobo: number | null
  currency: string | null
  entitlement_snapshot: Record<string, PremiumEntitlementValue> | null
  metadata: Record<string, unknown> | null
}

interface PremiumOverrideRow {
  id: string
  profile_id: string
  entitlement_key: string
  override_type: 'grant' | 'deny' | 'value'
  entitlement_value: PremiumEntitlementValue | null
  starts_at: string
  ends_at: string | null
  revoked_at: string | null
  reason: string | null
  actor: string | null
}

const PREMIUM_ENTITLEMENT_DEFAULTS: Record<PremiumEntitlementKey, PremiumEntitlementValue> = {
  'premium.tiktok.connect': false,
  'premium.tiktok.video_limit': 0,
  'premium.video.active_limit': 60,
  'premium.video.unlimited': false,
  'premium.feed.visibility_boost': 0,
  'premium.analytics.advanced': false,
  'premium.posts.schedule': false,
  'premium.posts.pin': false,
  'premium.badge': false,
  'premium.menu.multiple_tags': false,
  'premium.templates': false,
  'premium.support.priority': false,
  'premium.boost.discount_percent': 0,
}

const PREMIUM_FEATURE_LABELS: Record<PremiumEntitlementKey, string> = {
  'premium.tiktok.connect': 'TikTok connection',
  'premium.tiktok.video_limit': 'TikTok selection quota',
  'premium.video.active_limit': 'Active video quota',
  'premium.video.unlimited': 'Unlimited videos',
  'premium.feed.visibility_boost': 'Feed visibility uplift',
  'premium.analytics.advanced': 'Advanced analytics',
  'premium.posts.schedule': 'Scheduling',
  'premium.posts.pin': 'Pinning',
  'premium.badge': 'Premium badge',
  'premium.menu.multiple_tags': 'Multiple menu tags',
  'premium.templates': 'Templates',
  'premium.support.priority': 'Priority support',
  'premium.boost.discount_percent': 'Boost discount',
}

const FREE_BENEFIT_KEYS: PremiumEntitlementKey[] = [
  'premium.tiktok.connect',
  'premium.tiktok.video_limit',
  'premium.video.active_limit',
  'premium.video.unlimited',
  'premium.feed.visibility_boost',
  'premium.analytics.advanced',
  'premium.posts.schedule',
  'premium.posts.pin',
  'premium.badge',
  'premium.menu.multiple_tags',
  'premium.templates',
  'premium.support.priority',
  'premium.boost.discount_percent',
]

const PREMIUM_BENEFIT_MAP: Record<string, PremiumEntitlementKey> = {
  tiktok_connection: 'premium.tiktok.connect',
  tiktok_selection_quota: 'premium.tiktok.video_limit',
  visibility_boost: 'premium.feed.visibility_boost',
  analytics: 'premium.analytics.advanced',
  scheduling: 'premium.posts.schedule',
  badge: 'premium.badge',
  unlimited_videos: 'premium.video.unlimited',
  selected_tiktok_videos: 'premium.tiktok.video_limit',
  pinning: 'premium.posts.pin',
  multiple_menu_tags: 'premium.menu.multiple_tags',
  templates: 'premium.templates',
  priority_support: 'premium.support.priority',
  boost_discount_percent: 'premium.boost.discount_percent',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return ['true', '1', 'yes', 'on', 'enabled'].includes(value.toLowerCase())
  if (isRecord(value) && 'enabled' in value) return asBoolean(value.enabled, fallback)
  return fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (isRecord(value)) {
    if ('amount' in value) return asNumber(value.amount, fallback)
    if ('value' in value) return asNumber(value.value, fallback)
  }
  return fallback
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toJSONValue(value: unknown): PremiumEntitlementValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || value === null) return value
  return null
}

function isFuture(value: string | null | undefined) {
  return Boolean(value && new Date(value).getTime() > Date.now())
}

function isPast(value: string | null | undefined) {
  return Boolean(value && new Date(value).getTime() <= Date.now())
}

function entitlementValueTruthy(value: PremiumEntitlementValue): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  return Boolean(value && String(value).trim())
}

function entitlementValueForKey(key: PremiumEntitlementKey, value: PremiumEntitlementValue | undefined): PremiumEntitlementValue {
  if (value !== undefined) return value
  return PREMIUM_ENTITLEMENT_DEFAULTS[key]
}

function currentUTC() {
  return new Date().toISOString()
}

async function safeQuery<T>(task: PromiseLike<{ data: T | null; error?: { message?: string } | null }>, fallback: T | null = null): Promise<T | null> {
  try {
    const res = await task
    if (res?.error) return fallback
    return res?.data ?? fallback
  } catch {
    return fallback
  }
}

async function resolveProfileId(db: ReturnType<typeof createSupabaseAdmin>, session: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!session?.userId) return null
  const column = session.role === 'customer'
    ? 'customer_id'
    : session.role === 'vendor'
      ? 'vendor_id'
      : session.role === 'rider'
        ? 'rider_id'
        : 'admin_id'
  const profile = await safeQuery(
    db.from('social_profiles').select('id, profile_kind').eq(column, session.userId).maybeSingle(),
  )
  return profile ? String((profile as { id: string }).id) : null
}

async function resolveProfileRow(db: ReturnType<typeof createSupabaseAdmin>, profileId: string) {
  return safeQuery(
    db.from('social_profiles').select('id, profile_kind, vendor_id, customer_id, rider_id, admin_id').eq('id', profileId).maybeSingle(),
  )
}

async function resolveProfileKind(db: ReturnType<typeof createSupabaseAdmin>, profileId: string): Promise<SessionRole | null> {
  const profile = await resolveProfileRow(db, profileId)
  const kind = String((profile as { profile_kind?: string } | null)?.profile_kind ?? '')
  if (kind === 'customer' || kind === 'vendor' || kind === 'rider' || kind === 'admin') return kind
  return null
}

async function loadSettingsFallback(db: ReturnType<typeof createSupabaseAdmin>) {
  const [enabled, newSubscriptionsEnabled, trialsEnabled, premiumUIVisible] = await Promise.all([
    getFeature('premium_enabled'),
    getFeature('premium_new_subscriptions_enabled'),
    getFeature('premium_trials_enabled'),
    safeQuery(db.from('settings').select('value').eq('id', 'feature.premium_ui_visible').maybeSingle()),
  ])
  const premiumUIVisibleSetting = premiumUIVisible && isRecord((premiumUIVisible as { value?: unknown } | null)?.value)
    ? asBoolean((premiumUIVisible as { value?: unknown } | null)?.value, true)
    : true
  return {
    premiumEnabled: enabled,
    newSubscriptionsEnabled,
    trialsEnabled,
    premiumUIVisible: premiumUIVisibleSetting,
  }
}

export async function loadPremiumConfig(): Promise<PremiumConfig> {
  const db = createSupabaseAdmin()
  const row = await safeQuery(
    db.from('premium_config').select('*').eq('config_key', 'global').maybeSingle(),
  )
  if (row && isRecord(row)) {
    const configRow = row as Record<string, unknown>
    return {
      premiumEnabled: asBoolean(configRow.premium_enabled, false),
      newSubscriptionsEnabled: asBoolean(configRow.new_subscriptions_enabled, false),
      trialsEnabled: asBoolean(configRow.trials_enabled, false),
      premiumUIVisible: asBoolean(configRow.premium_ui_visible, true),
      preserveExistingUntilExpiry: asBoolean(configRow.preserve_existing_until_expiry, true),
      immediateDisableExistingBenefits: asBoolean(configRow.immediate_disable_existing_benefits, false),
      premiumFallbackPolicy: (asString(configRow.premium_fallback_policy, 'preserve_existing_until_expiry') as PremiumFallbackPolicy),
      metadata: isRecord(configRow.metadata) ? configRow.metadata : {},
      updatedAt: typeof configRow.updated_at === 'string' ? configRow.updated_at : null,
      createdAt: typeof configRow.created_at === 'string' ? configRow.created_at : null,
    }
  }

  const fallback = await loadSettingsFallback(db)
  return {
    ...fallback,
    preserveExistingUntilExpiry: true,
    immediateDisableExistingBenefits: false,
    premiumFallbackPolicy: 'preserve_existing_until_expiry',
    metadata: {},
    updatedAt: null,
    createdAt: null,
  }
}

export async function resolvePremiumFallbackPolicy() {
  const config = await loadPremiumConfig()
  return config.premiumFallbackPolicy
}

async function loadPremiumPlanVersionMap(db: ReturnType<typeof createSupabaseAdmin>) {
  const versions = await safeQuery(
    db.from('plan_versions')
      .select('id, premium_plan_id, version, change_summary, monthly_price_kobo, yearly_price_kobo, trial_duration_days, grace_period_days, currency, audience, included_entitlements, entitlement_values, display_metadata, effective_from, effective_until, is_active, created_by, reason')
      .order('version', { ascending: false })
      .order('created_at', { ascending: false }),
    [],
  )
  const rows = Array.isArray(versions) ? versions : []
  const latestByPlan = new Map<string, PremiumPlanVersionRow>()
  for (const row of rows as unknown[]) {
    if (!isRecord(row)) continue
    const planId = asString(row.premium_plan_id, '')
    if (!planId || latestByPlan.has(planId)) continue
    latestByPlan.set(planId, {
      id: asString(row.id, ''),
      premium_plan_id: planId,
      version: asNumber(row.version, 1),
      change_summary: typeof row.change_summary === 'string' ? row.change_summary : null,
      monthly_price_kobo: typeof row.monthly_price_kobo === 'number' ? row.monthly_price_kobo : null,
      yearly_price_kobo: typeof row.yearly_price_kobo === 'number' ? row.yearly_price_kobo : null,
      trial_duration_days: typeof row.trial_duration_days === 'number' ? row.trial_duration_days : null,
      grace_period_days: typeof row.grace_period_days === 'number' ? row.grace_period_days : null,
      currency: typeof row.currency === 'string' ? row.currency : null,
      audience: (row.audience as PremiumPlanAudience | null) ?? null,
      included_entitlements: isRecord(row.included_entitlements) ? row.included_entitlements as Record<string, boolean> : null,
      entitlement_values: isRecord(row.entitlement_values) ? row.entitlement_values as Record<string, PremiumEntitlementValue> : null,
      display_metadata: isRecord(row.display_metadata) ? row.display_metadata : null,
      effective_from: typeof row.effective_from === 'string' ? row.effective_from : null,
      effective_until: typeof row.effective_until === 'string' ? row.effective_until : null,
      is_active: typeof row.is_active === 'boolean' ? row.is_active : null,
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
      reason: typeof row.reason === 'string' ? row.reason : null,
    })
  }
  return latestByPlan
}

export async function loadPremiumPlans() {
  const db = createSupabaseAdmin()
  const [plansRes, versionMap] = await Promise.all([
    safeQuery(
      db.from('premium_plans')
        .select('id, plan_key, name, description, monthly_price_kobo, yearly_price_kobo, currency, trial_duration_days, grace_period_days, audience, included_benefits, display_order, paystack_plan_reference, version, effective_from, is_active, created_at, updated_at')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false }),
      [],
    ),
    loadPremiumPlanVersionMap(db),
  ])
  const plans = Array.isArray(plansRes) ? plansRes : []
  return plans.map((plan) => {
    const planId = String((plan as { id?: string }).id ?? '')
    const latest = versionMap.get(planId)
    const versionEntitlements = latest?.entitlement_values ?? {}
    const includedBenefits = isRecord((plan as { included_benefits?: unknown }).included_benefits)
      ? (plan as { included_benefits: Record<string, boolean> }).included_benefits
      : {}
    const resolvedBenefits: Record<string, boolean> = { ...includedBenefits }
    for (const [key, entitlementKey] of Object.entries(PREMIUM_BENEFIT_MAP)) {
      const raw = versionEntitlements[entitlementKey] ?? includedBenefits[entitlementKey] ?? includedBenefits[key]
      resolvedBenefits[key] = entitlementValueTruthy(toJSONValue(raw))
    }
    return {
      id: planId,
      plan_key: String((plan as { plan_key?: string }).plan_key ?? ''),
      name: String((plan as { name?: string }).name ?? ''),
      description: typeof (plan as { description?: unknown }).description === 'string' ? String((plan as { description?: string }).description) : null,
      monthly_price_kobo: asNumber((plan as { monthly_price_kobo?: unknown }).monthly_price_kobo, 0),
      yearly_price_kobo: asNumber((plan as { yearly_price_kobo?: unknown }).yearly_price_kobo, 0),
      currency: String((plan as { currency?: string }).currency ?? 'NGN'),
      trial_duration_days: asNumber((plan as { trial_duration_days?: unknown }).trial_duration_days, 0),
      grace_period_days: asNumber((plan as { grace_period_days?: unknown }).grace_period_days, 0),
      audience: String((plan as { audience?: string }).audience ?? 'vendor') as PremiumPlanAudience,
      included_benefits: resolvedBenefits,
      display_order: asNumber((plan as { display_order?: unknown }).display_order, 0),
      paystack_plan_reference: typeof (plan as { paystack_plan_reference?: unknown }).paystack_plan_reference === 'string' ? String((plan as { paystack_plan_reference: string }).paystack_plan_reference) : null,
      version: asNumber((plan as { version?: unknown }).version, 1),
      effective_from: typeof (plan as { effective_from?: unknown }).effective_from === 'string' ? String((plan as { effective_from: string }).effective_from) : null,
      is_active: Boolean((plan as { is_active?: unknown }).is_active),
      created_at: String((plan as { created_at?: string }).created_at ?? currentUTC()),
      updated_at: String((plan as { updated_at?: string }).updated_at ?? currentUTC()),
      latest_version: latest?.version ?? null,
      latest_change_summary: latest?.change_summary ?? null,
      latest_entitlement_values: versionEntitlements,
    } satisfies PremiumPlanRecord
  })
}

async function loadActiveSubscription(db: ReturnType<typeof createSupabaseAdmin>, profileId: string, vendorId: string | null = null) {
  const [modern, legacy] = await Promise.all([
    safeQuery(
      db.from('user_subscriptions')
        .select('id, profile_id, premium_plan_id, premium_plan_version_id, state, started_at, trial_ends_at, period_starts_at, period_ends_at, grace_ends_at, canceled_at, paused_at, manually_granted_at, manually_revoked_at, price_kobo, currency, entitlement_snapshot, metadata')
        .eq('profile_id', profileId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    safeQuery(
      db.from('vendor_subscriptions')
        .select('status, period_start, period_end, amount_kobo, paid_at')
        .eq('vendor_id', vendorId ?? profileId)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ])

  if (modern && isRecord(modern)) {
    const row = modern as unknown as PremiumSubscriptionRow
    return {
      source: 'user_subscriptions' as const,
      row,
    }
  }
  if (legacy && isRecord(legacy)) {
    return {
      source: 'vendor_subscriptions' as const,
      row: legacy as unknown as { status?: string; period_start?: string | null; period_end?: string | null; amount_kobo?: number | null; paid_at?: string | null },
    }
  }
  return null
}

async function loadOverrides(db: ReturnType<typeof createSupabaseAdmin>, profileId: string) {
  const rows = await safeQuery(
    db.from('entitlement_overrides')
      .select('id, profile_id, entitlement_key, override_type, entitlement_value, starts_at, ends_at, revoked_at, reason, actor')
      .eq('profile_id', profileId)
      .order('starts_at', { ascending: false })
      .order('created_at', { ascending: false }),
    [],
  )
  return (Array.isArray(rows) ? rows : [])
    .filter((row): row is PremiumOverrideRow => isRecord(row))
    .map((row) => ({
      id: asString(row.id, ''),
      profile_id: asString(row.profile_id, ''),
      entitlement_key: asString(row.entitlement_key, ''),
      override_type: row.override_type,
      entitlement_value: toJSONValue(row.entitlement_value),
      starts_at: asString(row.starts_at, currentUTC()),
      ends_at: typeof row.ends_at === 'string' ? row.ends_at : null,
      revoked_at: typeof row.revoked_at === 'string' ? row.revoked_at : null,
      reason: typeof row.reason === 'string' ? row.reason : null,
      actor: typeof row.actor === 'string' ? row.actor : null,
    }))
}

async function loadPlanEntitlements(db: ReturnType<typeof createSupabaseAdmin>, planId: string | null, versionId: string | null) {
  const [versionRows, planRows] = await Promise.all([
    versionId
      ? safeQuery(
          db.from('premium_plan_entitlements')
            .select('entitlement_key, entitlement_value, source')
            .eq('plan_version_id', versionId),
          [],
        )
      : Promise.resolve([] as unknown[]),
    planId
      ? safeQuery(
          db.from('premium_plan_entitlements')
            .select('entitlement_key, entitlement_value, source')
            .eq('premium_plan_id', planId),
          [],
        )
      : Promise.resolve([] as unknown[]),
  ])
  const collected = [...(Array.isArray(versionRows) ? versionRows : []), ...(Array.isArray(planRows) ? planRows : [])]
  const out = new Map<PremiumEntitlementKey, PremiumEntitlementValue>()
  for (const row of collected) {
    if (!isRecord(row)) continue
    const key = asString(row.entitlement_key, '') as PremiumEntitlementKey
    if (!key) continue
    out.set(key, toJSONValue(row.entitlement_value))
  }
  return out
}

function normalizeState(raw: string | null | undefined): PremiumSubscriptionState {
  const state = String(raw ?? 'none').toLowerCase()
  if (state === 'trial' || state === 'trialing') return 'trialing'
  if (state === 'active') return 'active'
  if (state === 'grace' || state === 'grace_period') return 'grace_period'
  if (state === 'past_due' || state === 'past-due') return 'past_due'
  if (state === 'cancelled' || state === 'canceled') return 'canceled'
  if (state === 'expired') return 'expired'
  if (state === 'paused') return 'paused'
  if (state === 'manually_granted') return 'manually_granted'
  if (state === 'manually_revoked') return 'manually_revoked'
  return 'none'
}

function subscriptionActiveUntil(state: PremiumSubscriptionState, row: { trial_ends_at?: string | null; period_ends_at?: string | null; grace_ends_at?: string | null; canceled_at?: string | null; manually_granted_at?: string | null; manually_revoked_at?: string | null }) {
  if (state === 'trialing') return row.trial_ends_at ?? row.period_ends_at ?? null
  if (state === 'active') return row.period_ends_at ?? null
  if (state === 'grace_period' || state === 'past_due') return row.grace_ends_at ?? row.period_ends_at ?? null
  if (state === 'canceled') return row.period_ends_at ?? null
  if (state === 'manually_granted') return row.manually_granted_at ?? row.period_ends_at ?? null
  if (state === 'manually_revoked') return row.manually_revoked_at ?? null
  return null
}

function resolveCoreEntitlements(input: {
  config: PremiumConfig
  subscriptionState: PremiumSubscriptionState
  subscriptionEndsAt: string | null
  planEntitlements: Map<PremiumEntitlementKey, PremiumEntitlementValue>
  subscriptionSnapshot: PremiumEntitlementState
  overrides: PremiumOverrideRow[]
  allowPremium: boolean
}) {
  const entitlements: PremiumEntitlementState = { ...PREMIUM_ENTITLEMENT_DEFAULTS }
  const applied: PremiumEntitlementKey[] = []
  const allowByState = input.allowPremium && (
    input.subscriptionState === 'active' ||
    input.subscriptionState === 'trialing' ||
    input.subscriptionState === 'grace_period' ||
    input.subscriptionState === 'past_due' ||
    input.subscriptionState === 'canceled' ||
    input.subscriptionState === 'manually_granted'
  )
  const preserveUntilExpiry = input.config.premiumFallbackPolicy === 'preserve_existing_until_expiry'
  const forcedPremium = input.config.premiumFallbackPolicy === 'grant_all_premium_features'
  const deniedByPolicy = input.config.premiumFallbackPolicy === 'deny_all_premium_features'
  const validSubscription = allowByState && (!input.subscriptionEndsAt || isFuture(input.subscriptionEndsAt))
  const premiumAllowed = input.config.premiumEnabled
    ? (allowByState && (validSubscription || input.subscriptionState === 'manually_granted' || input.subscriptionState === 'grace_period' || input.subscriptionState === 'past_due'))
    : (forcedPremium || (preserveUntilExpiry && validSubscription))

  for (const key of FREE_BENEFIT_KEYS) {
    entitlements[key] = PREMIUM_ENTITLEMENT_DEFAULTS[key]
  }

  if (premiumAllowed && !deniedByPolicy) {
    for (const key of FREE_BENEFIT_KEYS) {
      const base = input.subscriptionSnapshot[key]
      const planValue = input.planEntitlements.get(key)
      const derived = base ?? planValue ?? PREMIUM_ENTITLEMENT_DEFAULTS[key]
      entitlements[key] = derived
      applied.push(key)
    }

    if (input.subscriptionState === 'manually_granted') {
      entitlements['premium.video.active_limit'] = entitlements['premium.video.active_limit'] ?? 240
      entitlements['premium.tiktok.connect'] = true
      entitlements['premium.analytics.advanced'] = true
      entitlements['premium.posts.schedule'] = true
      entitlements['premium.posts.pin'] = true
      entitlements['premium.badge'] = true
      entitlements['premium.menu.multiple_tags'] = true
      entitlements['premium.templates'] = true
      entitlements['premium.support.priority'] = true
      entitlements['premium.feed.visibility_boost'] = entitlements['premium.feed.visibility_boost'] || 1
      entitlements['premium.tiktok.video_limit'] = entitlements['premium.tiktok.video_limit'] || 20
      entitlements['premium.boost.discount_percent'] = entitlements['premium.boost.discount_percent'] || 10
      entitlements['premium.video.unlimited'] = Boolean(entitlements['premium.video.unlimited'])
    }
  }

  for (const override of input.overrides) {
    const key = override.entitlement_key as PremiumEntitlementKey
    if (!(key in entitlements)) continue
    if (override.override_type === 'deny') {
      entitlements[key] = typeof PREMIUM_ENTITLEMENT_DEFAULTS[key] === 'boolean' ? false : 0
      continue
    }
    if (override.override_type === 'grant') {
      entitlements[key] = typeof PREMIUM_ENTITLEMENT_DEFAULTS[key] === 'boolean' ? true : (PREMIUM_ENTITLEMENT_DEFAULTS[key] ?? 1)
      continue
    }
    if (override.override_type === 'value') {
      entitlements[key] = override.entitlement_value ?? PREMIUM_ENTITLEMENT_DEFAULTS[key]
    }
  }

  const activeEntitlementKeys = Object.entries(entitlements)
    .filter(([, value]) => entitlementValueTruthy(value))
    .map(([key]) => key as PremiumEntitlementKey)

  return { entitlements, activeEntitlementKeys, applied, premiumGranted: premiumAllowed }
}

export function resolvePremiumStatus(input: {
  premiumEnabled?: boolean
  newSubscriptionsEnabled?: boolean
  trialsEnabled?: boolean
  premiumUIVisible?: boolean
  premiumFallbackPolicy?: PremiumFallbackPolicy
  role: SessionRole | null
  profileId: string | null
  activeEntitlementKeys?: PremiumEntitlementKey[]
  vendorSubscriptionEndsAt?: string | null
  vendorGraceEndsAt?: string | null
  trialEndsAt?: string | null
  activePlanKey?: string | null
  activePlanVersion?: number | null
  featureFlags?: Record<string, boolean>
  entitlements?: Partial<PremiumEntitlementState>
  subscriptionState?: PremiumSubscriptionState
  renewalOrExpiryAt?: string | null
  effectivePlan?: PremiumPlanRecord | null
  config?: PremiumConfig
  disabledReason?: string | null
  premiumGranted?: boolean
}): PremiumStatus {
  const config: PremiumConfig = input.config ?? {
    premiumEnabled: input.premiumEnabled ?? true,
    newSubscriptionsEnabled: input.newSubscriptionsEnabled ?? false,
    trialsEnabled: input.trialsEnabled ?? false,
    premiumUIVisible: input.premiumUIVisible ?? true,
    preserveExistingUntilExpiry: true,
    immediateDisableExistingBenefits: false,
    premiumFallbackPolicy: input.premiumFallbackPolicy ?? 'preserve_existing_until_expiry',
    metadata: {},
    updatedAt: null,
    createdAt: null,
  }

  const rawState = input.subscriptionState ?? (
    input.vendorSubscriptionEndsAt && isFuture(input.vendorSubscriptionEndsAt)
      ? 'active'
      : input.trialEndsAt && isFuture(input.trialEndsAt)
        ? 'trialing'
        : input.vendorGraceEndsAt && isFuture(input.vendorGraceEndsAt)
          ? 'grace_period'
          : 'none'
  )
  const renewalOrExpiryAt = input.renewalOrExpiryAt ?? input.vendorSubscriptionEndsAt ?? input.vendorGraceEndsAt ?? input.trialEndsAt ?? null
  const activePlanVersion = input.activePlanVersion ?? input.effectivePlan?.version ?? null

  const explicitEntitlements = input.entitlements ?? {}
  const entitlementKeys = Array.from(new Set([
    ...(input.activeEntitlementKeys ?? []),
    ...Object.entries(explicitEntitlements).filter(([, value]) => entitlementValueTruthy(value)).map(([key]) => key as PremiumEntitlementKey),
  ]))

  const baseEntitlements: PremiumEntitlementState = { ...PREMIUM_ENTITLEMENT_DEFAULTS }
  for (const key of input.activeEntitlementKeys ?? []) {
    baseEntitlements[key] = typeof PREMIUM_ENTITLEMENT_DEFAULTS[key] === 'boolean'
      ? true
      : (typeof PREMIUM_ENTITLEMENT_DEFAULTS[key] === 'number' ? 1 : PREMIUM_ENTITLEMENT_DEFAULTS[key])
  }
  for (const key of Object.keys(explicitEntitlements) as PremiumEntitlementKey[]) {
    baseEntitlements[key] = explicitEntitlements[key] ?? baseEntitlements[key]
  }

  const featureFlags = input.featureFlags ?? {}
  const hasPremium = input.premiumGranted ?? entitlementKeys.some((key) => PREMIUM_ENTITLEMENT_DEFAULTS[key] !== baseEntitlements[key] && entitlementValueTruthy(baseEntitlements[key]))
  const subscriptionState = rawState
  const disabledReason = !config.premiumEnabled
    ? (config.premiumFallbackPolicy === 'deny_all_premium_features'
      ? 'Premium is disabled globally'
      : config.premiumFallbackPolicy === 'preserve_existing_until_expiry'
        ? 'Premium is globally disabled, but existing access is preserved until expiry when present'
        : 'Premium is globally disabled but fallback grants access')
    : input.disabledReason ?? null

  const benefits: Record<string, boolean> = Object.fromEntries(
    Object.entries(PREMIUM_BENEFIT_MAP).map(([featureKey, entitlementKey]) => [
      featureKey,
      entitlementValueTruthy(baseEntitlements[entitlementKey]),
    ]),
  )

  return {
    premiumEnabled: config.premiumEnabled,
    newSubscriptionsEnabled: config.newSubscriptionsEnabled,
    trialsEnabled: config.trialsEnabled,
    premiumUIVisible: config.premiumUIVisible,
    premiumFallbackPolicy: config.premiumFallbackPolicy,
    role: input.role,
    profileId: input.profileId,
    hasPremium,
    subscriptionState,
    activePlanKey: input.activePlanKey ?? null,
    activePlanVersion,
    renewalOrExpiryAt,
    trialEndsAt: input.trialEndsAt ?? null,
    graceEndsAt: input.vendorGraceEndsAt ?? null,
    entitlementKeys: entitlementKeys,
    entitlements: baseEntitlements,
    featureFlags,
    benefits,
    disabledReason,
    effectivePlan: input.effectivePlan ?? null,
    config,
  }
}

export async function getEntitlements(profileId: string) {
  const db = createSupabaseAdmin()
  const profileRow = await resolveProfileRow(db, profileId)
  const profileKind = await resolveProfileKind(db, profileId)
  const config = await loadPremiumConfig()
  const legacyVendorId = String((profileRow as { vendor_id?: string | null } | null)?.vendor_id ?? '')
  const subscription = await loadActiveSubscription(db, profileId, legacyVendorId || null)
  const overrides = await loadOverrides(db, profileId)
  const planVersionMap = await loadPremiumPlanVersionMap(db)
  const plans = await loadPremiumPlans().catch(() => [])

  const subscriptionRow = subscription?.row
  const subscriptionState = subscription?.source === 'user_subscriptions'
    ? normalizeState((subscriptionRow as PremiumSubscriptionRow).state)
    : 'active'
  const subscriptionEndsAt = subscription?.source === 'user_subscriptions'
    ? subscriptionActiveUntil(subscriptionState, subscriptionRow as PremiumSubscriptionRow)
    : (subscriptionRow as { period_end?: string | null } | undefined)?.period_end ?? null

  const planId = subscription?.source === 'user_subscriptions'
    ? (subscriptionRow as PremiumSubscriptionRow | undefined)?.premium_plan_id ?? null
    : null
  const planVersionId = subscription?.source === 'user_subscriptions'
    ? (subscriptionRow as PremiumSubscriptionRow | undefined)?.premium_plan_version_id ?? null
    : null
  const planVersion = planVersionId ? planVersionMap.get(planId ?? '') : undefined
  const planEntitlements = await loadPlanEntitlements(db, planId, planVersionId)

  const snapshot = subscription?.source === 'user_subscriptions' && subscriptionRow
    ? (subscriptionRow as PremiumSubscriptionRow).entitlement_snapshot ?? {}
    : {}

  const resolved = resolveCoreEntitlements({
    config,
    subscriptionState,
    subscriptionEndsAt,
    planEntitlements,
    subscriptionSnapshot: snapshot as PremiumEntitlementState,
    overrides: overrides.filter((override) => {
      if (override.revoked_at) return false
      if (isPast(override.starts_at)) {
        return !override.ends_at || isFuture(override.ends_at)
      }
      return true
    }),
    allowPremium: true,
  })

  const activeEntitlementKeys = Object.entries(resolved.entitlements)
    .filter(([key, value]) => {
      const premiumKey = key as PremiumEntitlementKey
      return PREMIUM_ENTITLEMENT_DEFAULTS[premiumKey] !== value && entitlementValueTruthy(value)
    })
    .map(([key]) => key as PremiumEntitlementKey)

  return {
    profileKind,
    config,
    subscriptionState,
    subscriptionEndsAt,
    planVersion,
    resolved,
    premiumGranted: resolved.premiumGranted,
    subscriptionRow,
    overrides,
    plans,
    activeEntitlementKeys,
  }
}

export async function getPremiumStatus(profileId: string) {
  const bundle = await getEntitlements(profileId)
  const subscriptionRow = bundle.subscriptionRow
  const premiumPlanId = subscriptionRow && typeof subscriptionRow === 'object' && 'premium_plan_id' in subscriptionRow
    ? (subscriptionRow as PremiumSubscriptionRow).premium_plan_id
    : null
  const effectivePlan = premiumPlanId
    ? (bundle.plans.find((plan) => plan.id === premiumPlanId) ?? null)
    : (bundle.subscriptionState !== 'none'
      ? (bundle.plans.find((plan) => plan.audience === bundle.profileKind || plan.audience === 'all' || plan.audience === 'vendor') ?? null)
      : null)
  return resolvePremiumStatus({
    premiumEnabled: bundle.config.premiumEnabled,
    newSubscriptionsEnabled: bundle.config.newSubscriptionsEnabled,
    trialsEnabled: bundle.config.trialsEnabled,
    premiumUIVisible: bundle.config.premiumUIVisible,
    premiumFallbackPolicy: bundle.config.premiumFallbackPolicy,
    role: bundle.profileKind,
    profileId,
    activeEntitlementKeys: bundle.activeEntitlementKeys,
    vendorSubscriptionEndsAt: bundle.subscriptionEndsAt,
    vendorGraceEndsAt: bundle.subscriptionState === 'grace_period' ? bundle.subscriptionEndsAt : null,
    trialEndsAt: bundle.subscriptionState === 'trialing' ? bundle.subscriptionEndsAt : null,
    activePlanKey: effectivePlan?.plan_key ?? null,
    activePlanVersion: bundle.planVersion?.version ?? null,
    featureFlags: await getAllFeatures(),
    entitlements: bundle.resolved.entitlements,
    subscriptionState: bundle.subscriptionState,
    renewalOrExpiryAt: bundle.subscriptionEndsAt,
    effectivePlan,
    config: bundle.config,
    disabledReason: bundle.config.premiumEnabled ? null : 'Premium is globally disabled',
    premiumGranted: bundle.premiumGranted,
  })
}

export async function getEffectivePlan(profileId: string) {
  const bundle = await getEntitlements(profileId)
  const subscriptionRow = bundle.subscriptionRow
  const premiumPlanId = subscriptionRow && typeof subscriptionRow === 'object' && 'premium_plan_id' in subscriptionRow
    ? (subscriptionRow as PremiumSubscriptionRow).premium_plan_id
    : null
  const planKey = premiumPlanId
    ? (bundle.plans.find((plan) => plan.id === premiumPlanId) ?? null)
    : (bundle.subscriptionState !== 'none'
      ? (bundle.plans.find((plan) => plan.audience === (bundle.profileKind ?? 'vendor') || plan.audience === 'all' || plan.audience === 'vendor') ?? null)
      : null)
  return {
    plan: planKey,
    planVersion: bundle.planVersion ?? null,
    config: bundle.config,
    subscriptionState: bundle.subscriptionState,
    entitlements: bundle.resolved.entitlements,
  }
}

export async function hasEntitlement(profileId: string, entitlementKey: PremiumEntitlementKey) {
  const { resolved } = await getEntitlements(profileId)
  return entitlementValueTruthy(resolved.entitlements[entitlementKey])
}

export async function assertEntitlement(profileId: string, entitlementKey: PremiumEntitlementKey) {
  if (!(await hasEntitlement(profileId, entitlementKey))) {
    throw new Error(`Missing entitlement: ${entitlementKey}`)
  }
}

export async function getEntitlementValue(profileId: string, entitlementKey: PremiumEntitlementKey) {
  const { resolved } = await getEntitlements(profileId)
  return entitlementValueForKey(entitlementKey, resolved.entitlements[entitlementKey])
}

export async function resolveVideoQuotaFromEntitlements(profileId: string) {
  const db = createSupabaseAdmin()
  const { resolved, config } = await getEntitlements(profileId)
  let quota: { data: unknown; error: { message?: string } | null }
  try {
    quota = await db.rpc('feed_vendor_video_quota_usage', { p_profile_id: profileId })
  } catch {
    quota = { data: null, error: null }
  }
  const row = Array.isArray(quota.data) ? quota.data[0] : null
  const activeCount = Number(row?.active_count ?? 0)
  const baseLimit = entitlementValueTruthy(resolved.entitlements['premium.video.unlimited'])
    ? Number.POSITIVE_INFINITY
    : asNumber(resolved.entitlements['premium.video.active_limit'], 60)
  const limit = Number.isFinite(baseLimit) ? baseLimit : Number.POSITIVE_INFINITY
  const unlimited = !Number.isFinite(limit) || Boolean(resolved.entitlements['premium.video.unlimited'])
  const canPublish = unlimited || activeCount < limit
  return {
    activeCount,
    draftCount: Number(row?.draft_count ?? 0),
    archivedCount: Number(row?.archived_count ?? 0),
    processingCount: Number(row?.processing_count ?? 0),
    failedCount: Number(row?.failed_count ?? 0),
    storageBytes: Number(row?.storage_bytes ?? 0),
    limit,
    unlimited,
    remaining: unlimited ? null : Math.max(limit - activeCount, 0),
    canPublish,
    premiumActive: config.premiumEnabled && canPublish && Boolean(entitlementValueTruthy(resolved.entitlements['premium.video.unlimited']) || entitlementValueTruthy(resolved.entitlements['premium.video.active_limit']) || entitlementValueTruthy(resolved.entitlements['premium.analytics.advanced']) || entitlementValueTruthy(resolved.entitlements['premium.posts.schedule']) || entitlementValueTruthy(resolved.entitlements['premium.badge'])),
  }
}

export async function loadPremiumStatus() {
  const db = createSupabaseAdmin()
  const session = await getCurrentUser()
  const config = await loadPremiumConfig()

  if (!session) {
    return resolvePremiumStatus({ premiumEnabled: config.premiumEnabled, newSubscriptionsEnabled: config.newSubscriptionsEnabled, trialsEnabled: config.trialsEnabled, premiumUIVisible: config.premiumUIVisible, premiumFallbackPolicy: config.premiumFallbackPolicy, role: null, profileId: null, activeEntitlementKeys: [], featureFlags: await getAllFeatures(), config, disabledReason: 'No authenticated session', premiumGranted: false })
  }

  const profileId = await resolveProfileId(db, session)
  if (!profileId) {
    return resolvePremiumStatus({ premiumEnabled: config.premiumEnabled, newSubscriptionsEnabled: config.newSubscriptionsEnabled, trialsEnabled: config.trialsEnabled, premiumUIVisible: config.premiumUIVisible, premiumFallbackPolicy: config.premiumFallbackPolicy, role: session.role, profileId: null, activeEntitlementKeys: [], featureFlags: await getAllFeatures(), config, disabledReason: 'Profile not found', premiumGranted: false })
  }

  return getPremiumStatus(profileId)
}

export async function premiumFeatureAllowed(key: keyof typeof PREMIUM_BENEFIT_MAP) {
  const status = await loadPremiumStatus()
  return Boolean(status.benefits[key])
}

export { PREMIUM_BENEFIT_MAP, PREMIUM_FEATURE_LABELS, PREMIUM_ENTITLEMENT_DEFAULTS, FREE_BENEFIT_KEYS }
