import { NextResponse } from 'next/server'
import { loadPremiumConfig, loadPremiumPlans } from '@/lib/premium'

export async function GET() {
  try {
    const [config, plans] = await Promise.all([
      loadPremiumConfig(),
      loadPremiumPlans(),
    ])
    return NextResponse.json({ ok: true, enabled: config.premiumEnabled, premiumUIVisible: config.premiumUIVisible, fallbackPolicy: config.premiumFallbackPolicy, plans })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load premium plans' }, { status: 400 })
  }
}
