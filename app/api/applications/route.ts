import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getFeature } from '@/lib/features'
import { normalizePhone } from '@/lib/phone'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { verifyPhoneVerified, PHONE_VERIFIED_COOKIE, verifiedCookieOptions } from '@/lib/phone-verify'
import { audit } from '@/lib/audit'
import { loadAdminRecipients, notifyFeedRecipients } from '@/lib/feed/notifications'

export const runtime = 'nodejs'

const businessRegistrationStatus = z.enum(['cac_registered', 'cac_in_progress', 'not_registered'])

const applicationInput = z.object({
  kind: z.enum(['vendor', 'rider']),
  phone: z.string().trim().min(7).max(20),
  name: z.string().trim().min(2).max(100).optional(),
  owner_name: z.string().trim().min(2).max(100).optional(),
  full_name: z.string().trim().min(2).max(100).optional(),
  business_name: z.string().trim().min(2).max(120).optional(),
  business_registration_status: businessRegistrationStatus.optional(),
  cac_number: z.string().trim().min(4).max(50).optional(),
  cac_document_url: z.string().trim().max(500).optional(),
  category: z.string().trim().min(2).max(50).optional(),
  merchant_category: z.enum(['restaurant', 'supermarket', 'pharmacy']).optional(),
  what_they_sell: z.string().trim().min(2).max(400).optional(),
  rough_location_description: z.string().trim().min(2).max(200).optional(),
  area: z.string().trim().min(2).max(200).optional(),
  operating_hours: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(280).optional(),
  nin: z.string().trim().max(50).optional(),
  id_photo_url: z.string().trim().max(500).optional(),
  live_selfie_url: z.string().trim().max(500).optional(),
  guarantor_name: z.string().trim().max(100).optional(),
  guarantor_phone: z.string().trim().max(20).optional(),
  vehicle_type: z.enum(['bike', 'bicycle', 'foot']).optional(),
  vehicle_photo_url: z.string().trim().max(500).optional(),
  plate_number: z.string().trim().max(40).optional(),
  date_of_birth: z.string().trim().max(20).optional(),
}).superRefine((value, ctx) => {
  if (value.kind === 'vendor') {
    if (!value.owner_name && !value.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['owner_name'], message: 'Enter the owner or contact person name.' })
    }
    if (!value.business_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['business_name'], message: 'Enter the business or shop name.' })
    }
    if (!value.business_registration_status) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['business_registration_status'], message: 'Tell us the CAC or business registration status.' })
    }
    if (value.business_registration_status === 'cac_registered' && !value.cac_number) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cac_number'], message: 'Enter the CAC registration number.' })
    }
    if (!value.category && !value.merchant_category) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'Choose a business category.' })
    }
    if (!value.what_they_sell && !value.notes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['what_they_sell'], message: 'Tell us what you sell.' })
    }
    if (!value.rough_location_description && !value.area) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rough_location_description'], message: 'Tell us your rough location.' })
    }
  }

  if (value.kind === 'rider') {
    if (!value.full_name && !value.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['full_name'], message: 'Enter the rider full name.' })
    }
    if (!value.guarantor_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['guarantor_name'], message: 'Enter a guarantor name.' })
    }
    if (!value.guarantor_phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['guarantor_phone'], message: 'Enter a guarantor phone number.' })
    }
    if (!value.vehicle_type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicle_type'], message: 'Choose how you deliver.' })
    }
  }
})

function applicationVerifiedCookie(req: NextRequest): string | undefined {
  return req.cookies.get(PHONE_VERIFIED_COOKIE)?.value
}

function collectVendorReviewFlags(input: {
  owner_name: string
  business_name: string
  area: string | null
  what_they_sell: string
  business_registration_status: z.infer<typeof businessRegistrationStatus>
  cac_number?: string
}) {
  const flags: string[] = []
  const searchable = `${input.owner_name} ${input.business_name} ${input.area ?? ''} ${input.what_they_sell}`.toLowerCase()
  const suspiciousPhrases = ['bitcoin', 'forex', 'loan', 'investment', 'betting', 'casino', 'airdrop', 'adult', 'sex']

  if (suspiciousPhrases.some((phrase) => searchable.includes(phrase))) {
    flags.push('Contains keywords that need manual suitability review.')
  }
  if (searchable.includes('http://') || searchable.includes('https://') || searchable.includes('www.')) {
    flags.push('Contains promotional links that should be checked by admin.')
  }
  if (input.business_registration_status === 'cac_registered' && !input.cac_number) {
    flags.push('Marked CAC registered without a CAC number.')
  }
  if ((input.area ?? '').trim().length < 8) {
    flags.push('Location description is too short for a confident review.')
  }

  return flags
}

export async function POST(req: NextRequest) {
  if (!(await getFeature('partner_applications'))) {
    return NextResponse.json({ error: 'Applications are currently closed.' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const rl = await rateLimitGeneric(`partner-applications:${ip}`, 10, 3600)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many application attempts. Please try again later.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = applicationInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid application details.' }, { status: 400 })
  }

  let phone: string
  try {
    phone = normalizePhone(parsed.data.phone)
  } catch {
    return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const verificationRequired = await getFeature('phone_verification')
  if (verificationRequired) {
    const verified = await verifyPhoneVerified(applicationVerifiedCookie(req), phone, 'application')
    if (!verified) {
      return NextResponse.json({ error: 'Verify this WhatsApp number before submitting the application.' }, { status: 403 })
    }
  }

  const now = new Date().toISOString()

  if (parsed.data.kind === 'vendor') {
    const { data: existingVendor } = await db.from('vendors').select('id').eq('phone', phone).maybeSingle()
    if (existingVendor) {
      return NextResponse.json({ error: 'A vendor already exists with this number.' }, { status: 409 })
    }

    const owner_name = parsed.data.owner_name ?? parsed.data.name ?? ''
    const business_name = parsed.data.business_name ?? ''
    const category = parsed.data.category ?? parsed.data.merchant_category ?? 'restaurant'
    const rough_location_description = parsed.data.rough_location_description ?? parsed.data.area ?? null
    const what_they_sell = parsed.data.what_they_sell ?? parsed.data.notes ?? 'Not provided'
    const business_registration_status = parsed.data.business_registration_status ?? 'not_registered'
    const cac_number = parsed.data.cac_number?.trim() || null
    const cac_document_url = parsed.data.cac_document_url?.trim() || null
    const reviewFlags = collectVendorReviewFlags({
      owner_name,
      business_name,
      area: rough_location_description,
      what_they_sell,
      business_registration_status,
      cac_number: cac_number ?? undefined,
    })

    const { data: application, error: appError } = await db
      .from('vendor_applications')
      .insert({
        whatsapp_number: phone,
        whatsapp_verified: verificationRequired,
        business_name,
        owner_name,
        category,
        what_they_sell,
        rough_location_description,
        operating_hours: parsed.data.operating_hours ?? null,
        business_registration_status,
        cac_number,
        cac_document_url,
        verification_context: business_registration_status === 'cac_registered'
          ? 'Vendor says CAC is complete.'
          : business_registration_status === 'cac_in_progress'
            ? 'Vendor says CAC is in progress.'
            : 'Vendor says CAC is not yet registered.',
        review_notes: reviewFlags.length > 0 ? reviewFlags.join(' ') : null,
        status: 'application_submitted',
      })
      .select('id')
      .single()

    if (appError || !application) {
      return NextResponse.json({ error: 'Could not save your application right now.' }, { status: 500 })
    }

    const { data: vendor, error: vendorError } = await db
      .from('vendors')
      .insert({
        phone,
        shop_name: business_name,
        business_name,
        owner_name,
        category,
        rough_location_description,
        whatsapp_verified: verificationRequired,
        business_registration_status,
        cac_number,
        cac_document_url,
        approval_state: 'application_submitted',
        is_active: false,
        status: 'CLOSED',
        created_by_admin: false,
        business_verified: false,
        updated_at: now,
      })
      .select('id')
      .single()

    if (vendorError || !vendor) {
      return NextResponse.json({ error: 'Could not create your vendor record.' }, { status: 500 })
    }

    await db.from('vendor_applications').update({ vendor_id: vendor.id, updated_at: now }).eq('id', application.id)

    await audit({
      actor_id: phone,
      actor_role: 'customer',
      action: 'vendor_application_submitted',
      target_table: 'vendor_applications',
      target_id: application.id,
      new_value: { vendor_id: vendor.id, status: 'application_submitted' },
      ip_address: ip,
    })

    const admins = await loadAdminRecipients()
    await notifyFeedRecipients({
      recipients: admins,
      title: 'New vendor application',
      body: `${business_name} has applied for verification.`,
      link: '/super-admin/campus-partners',
      template: 'VENDOR_APPLICATION_SUBMITTED',
      tag: `vendor-application-${application.id}`,
    })

    const res = NextResponse.json({
      success: true,
      kind: 'vendor',
      application_id: application.id,
      vendor_id: vendor.id,
      message: 'Application Submitted. Thank you for applying to become a LumeX Fud vendor. Our team will review your application within 3-7 business days. We will contact you through your verified WhatsApp number if we need more information.',
    })
    res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
    return res
  }

  const { data: existingRider } = await db.from('riders').select('id').eq('phone', phone).maybeSingle()
  if (existingRider) {
    return NextResponse.json({ error: 'A rider already exists with this number.' }, { status: 409 })
  }

  const full_name = parsed.data.full_name ?? parsed.data.name ?? ''
  const riderApplication = {
    whatsapp_number: phone,
    whatsapp_verified: verificationRequired,
    full_name,
    date_of_birth: parsed.data.date_of_birth ?? null,
    nin: parsed.data.nin ?? null,
    id_photo_url: parsed.data.id_photo_url ?? null,
    live_selfie_url: parsed.data.live_selfie_url ?? null,
    guarantor_name: parsed.data.guarantor_name ?? '',
    guarantor_phone: parsed.data.guarantor_phone ?? '',
    vehicle_type: parsed.data.vehicle_type ?? 'bike',
    vehicle_photo_url: parsed.data.vehicle_photo_url ?? null,
    plate_number: parsed.data.plate_number ?? null,
    status: 'application_submitted',
  }

  const { data: application, error: appError } = await db
    .from('rider_applications')
    .insert(riderApplication)
    .select('id')
    .single()

  if (appError || !application) {
    return NextResponse.json({ error: 'Could not save your application right now.' }, { status: 500 })
  }

  const { data: rider, error: riderError } = await db
    .from('riders')
    .insert({
      phone,
      full_name,
      whatsapp_verified: verificationRequired,
      nin: parsed.data.nin ?? null,
      id_photo_url: parsed.data.id_photo_url ?? null,
      live_selfie_url: parsed.data.live_selfie_url ?? null,
      guarantor_name: parsed.data.guarantor_name ?? null,
      guarantor_phone: parsed.data.guarantor_phone ?? null,
      vehicle_type: parsed.data.vehicle_type ?? null,
      vehicle_photo_url: parsed.data.vehicle_photo_url ?? null,
      plate_number: parsed.data.plate_number ?? null,
      approval_state: 'application_submitted',
      is_active: false,
      status: 'OFFLINE',
      updated_at: now,
    })
    .select('id')
    .single()

  if (riderError || !rider) {
    return NextResponse.json({ error: 'Could not create your rider record.' }, { status: 500 })
  }

  await db.from('rider_applications').update({ rider_id: rider.id, updated_at: now }).eq('id', application.id)

  await audit({
    actor_id: phone,
    actor_role: 'customer',
    action: 'rider_application_submitted',
    target_table: 'rider_applications',
    target_id: application.id,
    new_value: { rider_id: rider.id, status: 'application_submitted' },
    ip_address: ip,
  })

  const res = NextResponse.json({
    success: true,
    kind: 'rider',
    application_id: application.id,
    rider_id: rider.id,
    message: 'Application Submitted. Thank you for applying to become a LumeX Fud rider. Our team will review your application within 3-7 business days. We will contact you through your verified WhatsApp number if we need more information.',
  })
  res.cookies.set(PHONE_VERIFIED_COOKIE, '', verifiedCookieOptions(0))
  return res
}
