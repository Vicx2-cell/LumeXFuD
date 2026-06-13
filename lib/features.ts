import { createSupabaseAdmin } from './supabase/server'

// Feature flags live in the existing `settings` table (TEXT id + JSONB value),
// keyed `feature.<key>` with value { enabled: boolean }. A missing row means
// "use the catalog default", so toggles work before any row exists.

export interface FeatureDef {
  key: string
  label: string
  description: string
  default: boolean
  /** True if the server actually enforces this flag (not just display). */
  enforced: boolean
}

export const FEATURES: FeatureDef[] = [
  { key: 'ai',           label: 'AI features (master)', description: 'MASTER kill switch for everything that spends Anthropic credit — Chow AI, leaderboard captions, dispute concierge, Sentinel, vendor/rider AI, study ingestion, and more. OFF = zero Anthropic API calls anywhere (no credit used). Turn ON only when the account has credit.', default: false, enforced: true },
  { key: 'ordering',     label: 'Ordering',        description: 'Allow customers to place new orders. Off = checkout is paused platform-wide.', default: true,  enforced: true },
  { key: 'signups',      label: 'New sign-ups',    description: 'Allow new customer accounts to be created.',                                       default: true,  enforced: true },
  { key: 'phone_verification', label: 'Phone verification (OTP)', description: 'Require new customers to verify their phone by OTP before sign-up. Turn OFF only while OTP delivery (Termii) is unavailable — accounts created while off have an unverified phone.', default: true, enforced: true },
  { key: 'wallet',       label: 'LumeX Wallet',    description: 'Show wallet top-up and wallet payment at checkout.',                               default: true,  enforced: false },
  { key: 'leaderboard',  label: 'Leaderboard',     description: 'Show the campus leaderboard and its bottom-nav tab.',                              default: true,  enforced: true },
  { key: 'face_id',      label: 'Face ID login',   description: 'Allow users to enrol Face ID / Touch ID as a second factor.',                      default: true,  enforced: false },
  { key: 'study',        label: 'Study (beta)',    description: 'Show the course-catalog study tool (faculty → programme → level → semester selector, then ask/practice). In development — off hides the /study section entirely.', default: true, enforced: true },
]

const settingId = (key: string) => `feature.${key}`

function coerce(value: unknown, fallback: boolean): boolean {
  if (value && typeof value === 'object' && 'enabled' in value) {
    return Boolean((value as { enabled: unknown }).enabled)
  }
  if (typeof value === 'boolean') return value
  return fallback
}

/** Read a single flag (server-side). Defaults to the catalog default if unset. */
export async function getFeature(key: string): Promise<boolean> {
  const def = FEATURES.find((f) => f.key === key)
  const fallback = def?.default ?? true
  try {
    const db = createSupabaseAdmin()
    const { data } = await db.from('settings').select('value').eq('id', settingId(key)).maybeSingle()
    if (!data) return fallback
    return coerce(data.value, fallback)
  } catch {
    return fallback
  }
}

/** Read every catalog flag merged with stored overrides. */
export async function getAllFeatures(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  for (const f of FEATURES) out[f.key] = f.default
  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('settings')
      .select('id, value')
      .in('id', FEATURES.map((f) => settingId(f.key)))
    for (const row of data ?? []) {
      const key = String(row.id).replace(/^feature\./, '')
      const def = FEATURES.find((f) => f.key === key)
      out[key] = coerce(row.value, def?.default ?? true)
    }
  } catch {
    // fall back to defaults already in `out`
  }
  return out
}

export { settingId as featureSettingId }
