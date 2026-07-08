import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getFeature } from '@/lib/features'
import { normalizePhone } from '@/lib/phone'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const applicationInput = z.object({
  kind: z.enum(['vendor', 'rider']),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(20),
  area: z.string().trim().min(2).max(160),
  business_name: z.string().trim().max(120).optional(),
  merchant_category: z.enum(['restaurant', 'supermarket', 'pharmacy']).optional(),
  vehicle_type: z.enum(['bike', 'bicycle', 'foot']).optional(),
  notes: z.string().trim().max(280).optional(),
}).superRefine((value, ctx) => {
  if (value.kind === 'vendor') {
    if (!value.business_name || value.business_name.trim().length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['business_name'], message: 'Enter the business or shop name.' })
    }
    if (!value.merchant_category) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['merchant_category'], message: 'Choose a merchant category.' })
    }
  }
  if (value.kind === 'rider' && !value.vehicle_type) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicle_type'], message: 'Choose how you deliver.' })
  }
})

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
  const { error } = await db.from('whatsapp_applications').insert({
    phone,
    kind: parsed.data.kind,
    name: parsed.data.name,
    details: {
      source: 'web',
      area: parsed.data.area,
      business_name: parsed.data.business_name ?? null,
      merchant_category: parsed.data.merchant_category ?? null,
      vehicle_type: parsed.data.vehicle_type ?? null,
      notes: parsed.data.notes ?? null,
    },
  })
  if (error) {
    return NextResponse.json({ error: 'Could not save your application right now.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
