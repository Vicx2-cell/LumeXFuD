import { createSupabaseAdmin } from './supabase/server'

/** Generate a unique order number: LXF-{YEAR}-{6-digit-seq} */
export async function generateOrderNumber(): Promise<string> {
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('generate_order_number')
  if (error || !data) {
    throw new Error('Failed to generate order number')
  }
  return data as string
}

/** Validate that a string looks like a LumeX order number */
export function isValidOrderNumber(s: string): boolean {
  return /^LXF-\d{4}-\d{6}$/.test(s)
}
