import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { nextVendorReviewState, requiredChecksPassed, VENDOR_VERIFICATION_CHECKS, vendorReadyForApproval } from '@/lib/onboarding'
import { createOfficialEventCollection, getOfficialAreaSettingByScope } from '@/lib/feed/official-scheduler'
import { renderApplicationEmail } from '@/lib/email/templates'
import { deliverWorkflowEmail } from '@/lib/email/workflow-email'

const updateInput = z.object({
  action: z.enum(['review', 'schedule_inspection', 'mark_inspected', 'verify', 'approve', 'reject', 'suspend', 'unsuspend']),
  reason: z.string().max(500).optional(),
  checks: z.record(z.string(), z.boolean()).optional(),
  official_latitude: z.number().min(-90).max(90).optional(),
  official_longitude: z.number().min(-180).max(180).optional(),
  storefront_photo_url: z.string().trim().url().max(500).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`admin-vendor-update:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = updateInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
  .select('id, shop_name, is_active, approval_state, official_latitude, official_longitude, storefront_photo_url, site_inspected, business_verified, verification_status, verification_checks, city_id, zone_id, logo_url, shop_photo_url, avg_rating, total_ratings')
    .eq('id', id)
    .single()
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  const vendorRatings = vendor as typeof vendor & { total_ratings?: number; avg_rating?: number }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updated_at: now }
  if (parsed.data.action !== 'verify') {
    updates.approval_state = nextVendorReviewState(vendor.approval_state, parsed.data.action)
  }

  if (parsed.data.action === 'review') {
    updates.is_active = false
  } else if (parsed.data.action === 'schedule_inspection') {
    updates.is_active = false
  } else if (parsed.data.action === 'mark_inspected') {
    updates.is_active = false
  } else if (parsed.data.action === 'verify') {
    if (session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Verification requires a super admin.' }, { status: 403 })
    }
    if (
      !requiredChecksPassed(VENDOR_VERIFICATION_CHECKS, parsed.data.checks) ||
      parsed.data.official_latitude === undefined ||
      parsed.data.official_longitude === undefined ||
      !parsed.data.storefront_photo_url
    ) {
      return NextResponse.json({ error: 'Complete every required check, GPS pin, and storefront photo.' }, { status: 409 })
    }
    updates.official_latitude = parsed.data.official_latitude
    updates.official_longitude = parsed.data.official_longitude
    updates.storefront_photo_url = parsed.data.storefront_photo_url
    updates.verification_checks = parsed.data.checks
    updates.verification_notes = parsed.data.reason ?? null
    updates.verification_status = 'verified'
    updates.verified_at = now
    updates.verified_by = session.phone
    updates.email_verified = true
    updates.email_verified_at = now
    updates.whatsapp_verified = true
    updates.id_verified = true
    updates.business_verified = true
    updates.site_inspected = true
    updates.approval_state = 'shop_inspected'
    updates.is_active = false
  } else if (parsed.data.action === 'approve') {
    if (session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Final approval requires a super admin.' }, { status: 403 })
    }
    if (!vendorReadyForApproval(vendor)) {
      return NextResponse.json(
        { error: 'Capture the official GPS pin and storefront photo before approval.' },
        { status: 409 },
      )
    }
    updates.is_active = true
    updates.approval_state = 'approved'
    updates.id_verified = true
    updates.site_inspected = true
    updates.business_verified = !!vendor.business_verified
    updates.approved_at = now
    updates.approved_by = session.phone
  } else if (parsed.data.action === 'reject') {
    updates.is_active = false
    updates.status = 'CLOSED'
    updates.approval_state = 'rejected'
    updates.rejection_reason = parsed.data.reason ?? null
  } else if (parsed.data.action === 'suspend') {
    updates.is_active = false
    updates.status = 'CLOSED'
    updates.approval_state = 'suspended'
  } else if (parsed.data.action === 'unsuspend') {
    if (vendor.approval_state !== 'approved') {
      return NextResponse.json({ error: 'Approve this vendor before unsuspending.' }, { status: 409 })
    }
    updates.is_active = true
    updates.status = 'OPEN'
    updates.approval_state = 'approved'
  }

  if (parsed.data.action === 'approve') {
    try {
      const areaScope = vendor.zone_id ? 'zone' : 'city'
      const areaId = String(vendor.zone_id ?? vendor.city_id ?? '')
      if (areaId) {
        const area = await getOfficialAreaSettingByScope(db, areaScope, areaId)
        if (area) {
          await createOfficialEventCollection({
            area,
            collectionType: 'new_on_lumex',
            reason: 'Recently approved vendor surfaced in New on LumeX.',
            sourceId: `vendor:${id}`,
            source: [{
              id: `vendor:${id}`,
              vendorId: id,
              vendorName: String(vendor.shop_name ?? 'Vendor'),
              itemName: String(vendor.shop_name ?? 'Vendor'),
              priceKobo: 0,
              imageUrl: String((vendor.shop_photo_url ?? vendor.logo_url ?? vendor.storefront_photo_url) ?? '') || null,
              imageBelongsToItem: Boolean(vendor.shop_photo_url ?? vendor.logo_url ?? vendor.storefront_photo_url),
              isAvailable: true,
              vendorApproved: true,
              vendorActive: true,
              vendorVisible: true,
              servesArea: true,
              areaScope,
              areaId,
              sourceType: 'vendor',
              sourceId: `vendor:${id}`,
              popularityOrders30d: Number(vendorRatings.total_ratings ?? 0),
              totalRatings: Number(vendorRatings.total_ratings ?? 0),
              avgRating: Number(vendorRatings.avg_rating ?? 0),
            } as never],
            publish: !!area?.autoPublish,
          })
        }
      }
    } catch (err) {
      console.error('[official-feed] vendor.approved failed:', err instanceof Error ? err.message : err)
    }
  }

  const { error: updateError } = await db.from('vendors').update(updates).eq('id', id)
  if (updateError) return NextResponse.json({ error: 'Could not update vendor review.' }, { status: 500 })

  if (['review', 'schedule_inspection', 'mark_inspected', 'approve', 'reject'].includes(parsed.data.action)) {
    const applicationStatus = parsed.data.action === 'approve' ? 'approved' : parsed.data.action === 'reject' ? 'rejected' : parsed.data.action === 'schedule_inspection' ? 'inspection_scheduled' : parsed.data.action === 'mark_inspected' ? 'shop_inspected' : 'under_review'
    const { data: application } = await db.from('vendor_applications').update({ status: applicationStatus, rejection_reason: parsed.data.action === 'reject' ? parsed.data.reason ?? null : undefined, updated_at: now }).eq('vendor_id', id).select('id, email, owner_name, reference_number').maybeSingle()
    if (application?.email && application.reference_number && ['approve', 'reject'].includes(parsed.data.action)) {
      const workflow = parsed.data.action === 'approve' ? 'application_approved' : 'application_rejected'
      const template = renderApplicationEmail({ workflow, name: application.owner_name, kind: 'vendor', reference: application.reference_number, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/auth`, reason: parsed.data.reason })
      const notice = await deliverWorkflowEmail(db, { eventKey: `${workflow}:vendor:${application.id}`, eventKind: parsed.data.action === 'approve' ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED', workflow, recipient: application.email, initiatedBy: 'admin', ...template })
      if (notice.status === 'sent') await db.from('vendor_applications').update({ applicant_notified_at: now }).eq('id', application.id)
      if (parsed.data.action === 'approve') {
        const welcome = renderApplicationEmail({ workflow: 'vendor_welcome', name: application.owner_name, kind: 'vendor', reference: application.reference_number, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/auth` })
        await deliverWorkflowEmail(db, { eventKey: `vendor-welcome:${application.id}`, eventKind: 'VENDOR_WELCOME', workflow: 'vendor_welcome', recipient: application.email, initiatedBy: 'admin', ...welcome })
      }
    }
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `vendor_${parsed.data.action}`,
    target_table: 'vendors',
    target_id: id,
    old_value: { is_active: vendor.is_active },
    new_value: updates,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}

// Soft-delete (remove) a vendor. We never hard-delete — orders, wallet rows and
// audit history must remain intact — so this sets deleted_at, which hides the
// vendor everywhere (listings, login, menus all filter `deleted_at IS NULL`).
const ACTIVE_ORDER_STATUSES = [
  'PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY',
  'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'DISPUTED',
]

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`admin-vendor-delete:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, is_active, deleted_at')
    .eq('id', id)
    .single()
  if (!vendor || vendor.deleted_at) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }

  // Don't strand customers mid-order.
  const { count } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('vendor_id', id)
    .in('status', ACTIVE_ORDER_STATUSES)
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Can't remove — this vendor has ${count} order(s) in progress. Resolve them first.` },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  await db.from('vendors').update({
    deleted_at: now,
    is_active: false,
    status: 'CLOSED',
    updated_at: now,
  }).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'vendor_remove',
    target_table: 'vendors',
    target_id: id,
    old_value: { is_active: vendor.is_active, deleted_at: null },
    new_value: { deleted_at: now },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
