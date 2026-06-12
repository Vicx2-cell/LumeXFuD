import { NextResponse } from 'next/server'
import { getAllFeatures } from '@/lib/features'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public, read-only flag map so the client can hide disabled features
// (e.g. wallet, leaderboard). Enforcement of sensitive flags is server-side.
export async function GET() {
  const features = await getAllFeatures()
  return NextResponse.json({ features })
}
