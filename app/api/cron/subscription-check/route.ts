import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth } from '@/lib/cron-health'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { audit } from '@/lib/audit'

// Called daily at 9am by Vercel cron (vercel.json: "0 9 * * *").
// Vendor subscriptions have a 3-day grace period after expiry:
//   day 1 / 2 / 3 → escalating WhatsApp reminders
//   after day 3   → shop deactivated (hidden from homepage)
// Monthly amounts are read from the settings table (never hardcoded).

interface VendorRow {
  id: string
  phone: string
  subscription_tier: 'FOUNDING' | 'EARLY' | 'STANDARD'
  subscription_paid_until: string | null
  is_active: boolean
}

const TIER_SETTING: Record<VendorRow['subscription_tier'], string> = {
  FOUNDING: 'subscription_founding',
  EARLY:    'subscription_early',
  STANDARD: 'subscription_standard',
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('subscription-check', () => POST(req))
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const now = Date.now()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const payUrl = `${appUrl}/vendor-dashboard`

  // Monthly fee per tier (kobo) from settings.
  const { data: settingsRows } = await db
    .from('settings')
    .select('id, value')
    .in('id', Object.values(TIER_SETTING))
  const monthlyKobo = new Map<string, number>()
  for (const row of (settingsRows ?? []) as Array<{ id: string; value: { monthly_kobo?: number } }>) {
    monthlyKobo.set(row.id, Number(row.value?.monthly_kobo ?? 0))
  }

  // Active vendors with a known paid-until date.
  const { data: vendorsRaw, error } = await db
    .from('vendors')
    .select('id, phone, subscription_tier, subscription_paid_until, is_active')
    .eq('is_active', true)
    .is('deleted_at', null)
    .not('subscription_paid_until', 'is', null)

  if (error) {
    console.error('[cron/subscription-check] DB error:', error.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const vendors = (vendorsRaw ?? []) as unknown as VendorRow[]
  let reminded = 0
  let deactivated = 0

  for (const v of vendors) {
    if (!v.subscription_paid_until) continue
    const expiredMs = now - new Date(v.subscription_paid_until).getTime()
    if (expiredMs <= 0) continue // not yet expired

    const daysOverdue = Math.floor(expiredMs / (24 * 60 * 60 * 1000)) + 1
    const amountNaira = Math.round((monthlyKobo.get(TIER_SETTING[v.subscription_tier]) ?? 0) / 100)

    if (daysOverdue <= 3) {
      const template = (['SUBSCRIPTION_EXPIRY_DAY_1', 'SUBSCRIPTION_EXPIRY_DAY_2', 'SUBSCRIPTION_EXPIRY_DAY_3'] as const)[daysOverdue - 1]
      sendWhatsAppWithFallback({
        to: v.phone,
        message: renderTemplate(template, { amount: amountNaira, pay_url: payUrl }),
      }).catch(() => {})
      reminded++
    } else {
      // Grace period over — hide the shop.
      await db.from('vendors').update({ is_active: false }).eq('id', v.id)
      await db
        .from('vendor_subscriptions')
        .update({ status: 'EXPIRED' })
        .eq('vendor_id', v.id)
        .eq('status', 'ACTIVE')

      sendWhatsAppWithFallback({
        to: v.phone,
        message: renderTemplate('SUBSCRIPTION_DEACTIVATED', { pay_url: payUrl }),
      }).catch(() => {})

      await audit({
        actor_id:     'SYSTEM',
        actor_role:   'admin',
        action:       'VENDOR_SUBSCRIPTION_DEACTIVATED',
        target_table: 'vendors',
        target_id:    v.id,
        new_value:    { reason: 'subscription_overdue_grace_expired', days_overdue: daysOverdue },
      })
      deactivated++
    }
  }

  return NextResponse.json({ checked: vendors.length, reminded, deactivated })
}
