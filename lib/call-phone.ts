import { createSupabaseAdmin } from './supabase/server'

// Resolve optional call numbers for a set of users WITHOUT risking the caller's
// main query: call_phone (migration 074) is read in its own query and a missing
// column / any error just yields an empty map (callers fall back to the WhatsApp
// number). So contact surfaces keep working on a DB where 074 hasn't run yet.
export async function callPhoneMap(
  table: 'customers' | 'vendors' | 'riders',
  ids: Array<string | null | undefined>,
  db: ReturnType<typeof createSupabaseAdmin> = createSupabaseAdmin(),
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[]
  if (!unique.length) return new Map()
  try {
    const { data, error } = await db.from(table).select('id, call_phone').in('id', unique)
    if (error || !data) return new Map()
    return new Map(
      (data as Array<{ id: string; call_phone: string | null }>)
        .filter((r) => r.call_phone)
        .map((r) => [r.id, r.call_phone as string]),
    )
  } catch {
    return new Map()
  }
}
