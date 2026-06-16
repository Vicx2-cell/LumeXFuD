import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getLumiMemory, overwriteLumiMemory, clearLumiMemory, type MemoryEdit } from '@/lib/lumi-memory'

export const runtime = 'nodejs'

// "What Lumi remembers" — the user-controlled view/edit/forget surface for the
// Lumi memory layer (NDPR + the trust promise). All access is the logged-in
// customer's OWN row only; we resolve customer_id from the session phone and
// never accept it from the client (BOLA prevention).
async function resolveCustomerId(phone: string): Promise<string | null> {
  const db = createSupabaseAdmin()
  const { data } = await db.from('customers').select('id').eq('phone', phone).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = await resolveCustomerId(session.phone)
  if (!customerId) return NextResponse.json({ memory: null })

  const db = createSupabaseAdmin()
  const memory = await getLumiMemory(db, customerId)
  return NextResponse.json({ memory })
}

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = await resolveCustomerId(session.phone)
  if (!customerId) return NextResponse.json({ error: 'No customer profile' }, { status: 400 })

  let body: MemoryEdit
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  // Whitelist editable fields only — never trust the raw body shape.
  const edit: MemoryEdit = {}
  if ('preferred_name' in body) edit.preferred_name = body.preferred_name
  if ('spice_level' in body) edit.spice_level = body.spice_level
  if ('budget_naira' in body) edit.budget_naira = body.budget_naira
  if ('dietary' in body) edit.dietary = body.dietary
  if ('favourites' in body) edit.favourites = body.favourites
  if ('dislikes' in body) edit.dislikes = body.dislikes
  if ('notes' in body) edit.notes = body.notes

  const db = createSupabaseAdmin()
  const memory = await overwriteLumiMemory(db, customerId, edit)
  return NextResponse.json({ memory })
}

export async function DELETE() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = await resolveCustomerId(session.phone)
  if (!customerId) return NextResponse.json({ ok: true })

  const db = createSupabaseAdmin()
  const ok = await clearLumiMemory(db, customerId)
  if (!ok) return NextResponse.json({ error: 'Could not clear memory' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
