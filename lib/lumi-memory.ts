import { createSupabaseAdmin } from '@/lib/supabase/server'
import { toKobo, toNaira } from '@/lib/money'

// Lumi's per-customer memory — the "knows me" layer (see migration 035). Read
// before each chat to personalize, and updated by Lumi's `remember` tool. Kept
// to TASTE + light personal context on purpose; sensitive disclosures are never
// stored (the prompt forbids it, and the caps/sanitizers here are the backstop).

export type SpiceLevel = 'none' | 'mild' | 'medium' | 'hot'

export interface LumiMemory {
  customer_id: string
  preferred_name: string | null
  spice_level: SpiceLevel | null
  dietary: string[]
  budget_typical_kobo: number | null
  favourites: string[]
  dislikes: string[]
  notes: string[]
  updated_at: string
}

// Shape Lumi may pass to the `remember` tool. All optional; arrays are *appended*
// (deduped), scalars are overwritten.
export interface RememberInput {
  preferred_name?: string
  spice_level?: string
  add_dietary?: string[]
  budget_naira?: number
  add_favourites?: string[]
  add_dislikes?: string[]
  add_notes?: string[]
}

// ─── Caps (cost + sanity bounds) ─────────────────────────────────────────────
const MAX_NAME = 40
const MAX_ITEM = 60 // a favourite/dislike/dietary entry
const MAX_NOTE = 200
const CAP_DIETARY = 10
const CAP_FAVOURITES = 25
const CAP_DISLIKES = 25
const CAP_NOTES = 40

const SPICE: readonly SpiceLevel[] = ['none', 'mild', 'medium', 'hot']

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/\s+/g, ' ')
  if (!s) return null
  return s.slice(0, max)
}

// Sanitize a fresh list (overwrite semantics): clean each entry, drop empties,
// case-insensitively dedupe, cap length.
function sanitizeList(incoming: unknown, maxItem: number, cap: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  if (Array.isArray(incoming)) {
    for (const raw of incoming) {
      const s = cleanStr(raw, maxItem)
      if (s && !seen.has(s.toLowerCase())) {
        out.push(s)
        seen.add(s.toLowerCase())
      }
    }
  }
  return out.slice(0, cap)
}

// Append new entries to an existing list, case-insensitively deduped, newest kept
// at the end, trimmed to `cap` (drops the oldest when over).
function mergeList(existing: string[], incoming: unknown, maxItem: number, cap: number): string[] {
  const out = [...existing]
  const seen = new Set(existing.map((s) => s.toLowerCase()))
  if (Array.isArray(incoming)) {
    for (const raw of incoming) {
      const s = cleanStr(raw, maxItem)
      if (s && !seen.has(s.toLowerCase())) {
        out.push(s)
        seen.add(s.toLowerCase())
      }
    }
  }
  return out.length > cap ? out.slice(out.length - cap) : out
}

const EMPTY = (customerId: string): LumiMemory => ({
  customer_id: customerId,
  preferred_name: null,
  spice_level: null,
  dietary: [],
  budget_typical_kobo: null,
  favourites: [],
  dislikes: [],
  notes: [],
  updated_at: new Date(0).toISOString(),
})

type DB = ReturnType<typeof createSupabaseAdmin>

/** Load a customer's Lumi memory, or null if none stored yet. */
export async function getLumiMemory(db: DB, customerId: string): Promise<LumiMemory | null> {
  const { data } = await db
    .from('lumi_memory')
    .select('customer_id, preferred_name, spice_level, dietary, budget_typical_kobo, favourites, dislikes, notes, updated_at')
    .eq('customer_id', customerId)
    .maybeSingle()
  return (data as LumiMemory | null) ?? null
}

/**
 * Apply a `remember` update and upsert it. Pure-ish merge: scalars overwrite,
 * arrays append+dedupe+cap. Returns the saved row, or null if the update was
 * entirely empty/invalid (nothing worth a write).
 */
export async function applyRemember(
  db: DB,
  customerId: string,
  input: RememberInput
): Promise<LumiMemory | null> {
  const current = (await getLumiMemory(db, customerId)) ?? EMPTY(customerId)

  const next: LumiMemory = { ...current }
  let changed = false

  const name = cleanStr(input.preferred_name, MAX_NAME)
  if (name) { next.preferred_name = name; changed = true }

  if (typeof input.spice_level === 'string' && SPICE.includes(input.spice_level.toLowerCase() as SpiceLevel)) {
    next.spice_level = input.spice_level.toLowerCase() as SpiceLevel
    changed = true
  }

  if (typeof input.budget_naira === 'number' && Number.isFinite(input.budget_naira) && input.budget_naira > 0) {
    next.budget_typical_kobo = toKobo(Math.min(input.budget_naira, 1_000_000))
    changed = true
  }

  const dietary = mergeList(current.dietary, input.add_dietary, MAX_ITEM, CAP_DIETARY)
  if (dietary.length !== current.dietary.length) { next.dietary = dietary; changed = true }

  const favourites = mergeList(current.favourites, input.add_favourites, MAX_ITEM, CAP_FAVOURITES)
  if (favourites.length !== current.favourites.length) { next.favourites = favourites; changed = true }

  const dislikes = mergeList(current.dislikes, input.add_dislikes, MAX_ITEM, CAP_DISLIKES)
  if (dislikes.length !== current.dislikes.length) { next.dislikes = dislikes; changed = true }

  const notes = mergeList(current.notes, input.add_notes, MAX_NOTE, CAP_NOTES)
  if (notes.length !== current.notes.length) { next.notes = notes; changed = true }

  if (!changed) return null

  next.updated_at = new Date().toISOString()
  const { data, error } = await db
    .from('lumi_memory')
    .upsert({
      customer_id: customerId,
      preferred_name: next.preferred_name,
      spice_level: next.spice_level,
      dietary: next.dietary,
      budget_typical_kobo: next.budget_typical_kobo,
      favourites: next.favourites,
      dislikes: next.dislikes,
      notes: next.notes,
      updated_at: next.updated_at,
    }, { onConflict: 'customer_id' })
    .select('customer_id, preferred_name, spice_level, dietary, budget_typical_kobo, favourites, dislikes, notes, updated_at')
    .single()

  if (error) {
    console.error('[lumi-memory] upsert failed:', error)
    return null
  }
  return data as LumiMemory
}

// User-driven edit from the "What Lumi remembers" screen. Any provided field is
// OVERWRITTEN (arrays replaced wholesale, scalars set — null clears them). This
// is how a student removes a note or fixes their name; it is not a merge.
export interface MemoryEdit {
  preferred_name?: string | null
  spice_level?: string | null
  budget_naira?: number | null
  dietary?: string[]
  favourites?: string[]
  dislikes?: string[]
  notes?: string[]
}

/** Overwrite the provided memory fields for a customer (user-controlled edit). */
export async function overwriteLumiMemory(
  db: DB,
  customerId: string,
  edit: MemoryEdit
): Promise<LumiMemory | null> {
  const current = (await getLumiMemory(db, customerId)) ?? EMPTY(customerId)
  const next: LumiMemory = { ...current }

  if ('preferred_name' in edit) next.preferred_name = cleanStr(edit.preferred_name, MAX_NAME)
  if ('spice_level' in edit) {
    const s = typeof edit.spice_level === 'string' ? edit.spice_level.toLowerCase() : null
    next.spice_level = s && SPICE.includes(s as SpiceLevel) ? (s as SpiceLevel) : null
  }
  if ('budget_naira' in edit) {
    next.budget_typical_kobo =
      typeof edit.budget_naira === 'number' && Number.isFinite(edit.budget_naira) && edit.budget_naira > 0
        ? toKobo(Math.min(edit.budget_naira, 1_000_000))
        : null
  }
  if ('dietary' in edit) next.dietary = sanitizeList(edit.dietary, MAX_ITEM, CAP_DIETARY)
  if ('favourites' in edit) next.favourites = sanitizeList(edit.favourites, MAX_ITEM, CAP_FAVOURITES)
  if ('dislikes' in edit) next.dislikes = sanitizeList(edit.dislikes, MAX_ITEM, CAP_DISLIKES)
  if ('notes' in edit) next.notes = sanitizeList(edit.notes, MAX_NOTE, CAP_NOTES)

  next.updated_at = new Date().toISOString()
  const { data, error } = await db
    .from('lumi_memory')
    .upsert({
      customer_id: customerId,
      preferred_name: next.preferred_name,
      spice_level: next.spice_level,
      dietary: next.dietary,
      budget_typical_kobo: next.budget_typical_kobo,
      favourites: next.favourites,
      dislikes: next.dislikes,
      notes: next.notes,
      updated_at: next.updated_at,
    }, { onConflict: 'customer_id' })
    .select('customer_id, preferred_name, spice_level, dietary, budget_typical_kobo, favourites, dislikes, notes, updated_at')
    .single()
  if (error) {
    console.error('[lumi-memory] overwrite failed:', error)
    return null
  }
  return data as LumiMemory
}

/** Wipe everything Lumi remembers about a customer (one-tap forget / NDPR erase). */
export async function clearLumiMemory(db: DB, customerId: string): Promise<boolean> {
  const { error } = await db.from('lumi_memory').delete().eq('customer_id', customerId)
  if (error) { console.error('[lumi-memory] clear failed:', error); return false }
  return true
}

/**
 * Render memory as a compact context block for Lumi's system prompt. `fallbackName`
 * (the customer's stored name) seeds how to address them before they've set a
 * preferred name. Returns a short "first meeting" note when nothing is known yet.
 */
export function formatMemoryForPrompt(mem: LumiMemory | null, fallbackName: string | null): string {
  const lines: string[] = []
  const callThem = mem?.preferred_name || fallbackName
  if (callThem) lines.push(`- Their name: ${callThem} (greet them by it).`)
  if (mem?.spice_level) lines.push(`- Spice preference: ${mem.spice_level}.`)
  if (mem?.dietary.length) lines.push(`- Dietary: ${mem.dietary.join(', ')}.`)
  if (mem?.budget_typical_kobo) lines.push(`- Usual budget: about ₦${Math.round(toNaira(mem.budget_typical_kobo))}.`)
  if (mem?.favourites.length) lines.push(`- Loves: ${mem.favourites.join(', ')}.`)
  if (mem?.dislikes.length) lines.push(`- Avoid suggesting: ${mem.dislikes.join(', ')}.`)
  if (mem?.notes.length) lines.push(`- Personal context they've shared: ${mem.notes.join('; ')}.`)

  if (lines.length === 0) {
    return callThem
      ? `You know their name (${callThem}) but little else yet — this is early in getting to know them. Be warm and learn their taste naturally.`
      : `You haven't really gotten to know this student yet. Be warm, find out what they like naturally, and remember it.`
  }
  return `WHAT YOU REMEMBER ABOUT THIS STUDENT (use it naturally — don't recite it back like a list):\n${lines.join('\n')}`
}
