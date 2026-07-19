import { slugify } from './seo/slug'

export type PublicHandleInput = {
  username?: string | null
  displayName?: string | null
  phone: string
}

type HandleDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>
      }
    }
  }
}

function cleanHandle(value: string): string {
  return slugify(value).slice(0, 30)
}

function phoneSuffix(phone: string, length = 4): string {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(Math.max(0, digits.length - length))
}

export function buildPublicHandleCandidates(input: PublicHandleInput): string[] {
  const candidates: string[] = []
  const username = cleanHandle(input.username ?? '')
  if (username) {
    candidates.push(username)
    return candidates
  }

  const nameHandle = cleanHandle(input.displayName ?? '')
  if (nameHandle) {
    candidates.push(nameHandle)
    candidates.push(cleanHandle(`${nameHandle}-${phoneSuffix(input.phone)}`))
  }

  candidates.push(cleanHandle(`customer-${phoneSuffix(input.phone, 6) || 'profile'}`))

  return Array.from(new Set(candidates.filter(Boolean)))
}

export async function chooseAvailablePublicHandle(
  db: unknown,
  input: PublicHandleInput,
): Promise<string> {
  const candidates = buildPublicHandleCandidates(input)
  const client = db as HandleDb
  for (const handle of candidates) {
    const { data } = await client
      .from('social_profiles')
      .select('id')
      .eq('handle', handle)
      .maybeSingle()
    if (!data) return handle
  }
  return candidates[0] ?? cleanHandle(`customer-${phoneSuffix(input.phone, 6) || 'profile'}`)
}

export function formatPublicHandle(handle: string): string {
  return cleanHandle(handle)
}

export function buildPublicDisplayName(name?: string | null, fallback?: string | null): string {
  const value = (name ?? fallback ?? '').trim()
  return value.slice(0, 120)
}
