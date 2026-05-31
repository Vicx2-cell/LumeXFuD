import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { getCurrentUser } from '@/lib/session'

const CACHE_KEY = 'paystack:banks:ng'
const CACHE_TTL = 86_400 // 24 hours

interface PaystackBank {
  name: string
  code: string
  longcode: string
  active: boolean
  is_deleted: boolean
}

interface CachedBank {
  name: string
  code: string
  longcode: string
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function fetchBanksFromPaystack(): Promise<CachedBank[]> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const res = await fetch('https://api.paystack.co/bank?country=nigeria&use_cursor=false&perPage=200', {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Paystack banks API failed: ${res.status}`)

  const json = (await res.json()) as { status: boolean; data: PaystackBank[] }
  if (!json.status || !Array.isArray(json.data)) throw new Error('Invalid Paystack banks response')

  return json.data
    .filter((b) => b.active && !b.is_deleted)
    .map((b) => ({ name: b.name, code: b.code, longcode: b.longcode }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const redis = getRedis()

  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get<CachedBank[]>(CACHE_KEY)
      if (cached) {
        return NextResponse.json({ banks: cached, cached: true })
      }
    } catch {
      // Cache miss — fall through
    }
  }

  // Fetch fresh from Paystack
  const banks = await fetchBanksFromPaystack().catch(() => null)
  if (!banks) {
    return NextResponse.json({ error: 'Failed to fetch bank list. Please try again.' }, { status: 502 })
  }

  // Cache for 24 hours
  if (redis) {
    try {
      await redis.set(CACHE_KEY, banks, { ex: CACHE_TTL })
    } catch {
      // Cache write failure is non-fatal
    }
  }

  return NextResponse.json({ banks, cached: false })
}
