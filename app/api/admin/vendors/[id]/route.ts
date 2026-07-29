import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { nextVendorReviewState, vendorReadyForApproval } from '@/lib/onboarding'
import { renderApplicationEmail } from '@/lib/email/templates'
import { deliverWorkflowEmail } from '@/lib/email/workflow-email'

const updateInput = z.object({
  action: z.enum(['review', 'schedule_inspection', 'mark_inspected', 'approve', 'reject', 'suspend', 'unsuspend', 'activate_premium']),
  reason: z.string().max(500).optional(),
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
  .select('id, shop_name, is_active, is_premium, approval_state, official_latitude, official_longitude, storefront_photo_url, site_inspected, business_verified, city_id, zone_id, logo_url, shop_photo_url, avg_rating, total_ratings')
    .eq('id', id)
    .single()
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updated_at: now }
  if (parsed.data.action !== 'activate_premium') {
    updates.approval_state = nextVendorReviewState(vendor.approval_state, parsed.data.action)
  }

  if (parsed.data.action === 'review') {
    updates.is_active = false
  } else if (parsed.data.action === 'schedule_inspection') {
    updates.is_active = false
  } else if (parsed.data.action === 'mark_inspected') {
    updates.site_inspected = true
    updates.is_active = false
  } else if (parsed.data.action === 'approve') {
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
  } else if (parsed.data.action === 'activate_premium') {
    updates.is_premium = true
  }

  await db.from('vendors').update(updates).eq('id', id)

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
