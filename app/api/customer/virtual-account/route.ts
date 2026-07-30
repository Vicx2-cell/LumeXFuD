import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { assignDedicatedAccount, createPaystackCustomer, fetchPaystackCustomer, maskVerificationIdentity, requeryDedicatedAccount } from '@/lib/paystack/virtual-accounts'

type SafeVirtualAccount = {
  bank_name: string | null
  account_name: string | null
  account_number: string | null
  provider_slug: string | null
  status: string
  consented_at?: string | null
  failure_reason?: string | null
}

const inputSchema = z.object({
  consent: z.literal(true),
  identity_type: z.enum(['bvn', 'nin']).optional(),
  identity_number: z.string().regex(/^\d{11}$/).optional(),
}).superRefine((v, ctx) => {
  if (v.identity_number && !v.identity_type) {
    ctx.addIssue({ code: 'custom', message: 'Choose BVN or NIN verification' })
  }
  if (v.identity_type && !v.identity_number) {
    ctx.addIssue({ code: 'custom', message: `Enter your ${v.identity_type.toUpperCase()}` })
  }
  if (process.env.PAYSTACK_DVA_COMPLIANCE_REQUIRED === 'true' && (!v.identity_type || !v.identity_number)) {
    ctx.addIssue({ code: 'custom', message: 'Choose BVN or NIN verification to request your LumeX account' })
  }
})

async function customerGate() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return { error: NextResponse.json({ error: 'Customer authentication required' }, { status: 401 }) }
  const dvaEnabled = await getFeature('customer_virtual_accounts')
  const dvaDisabledByEnv = process.env.PAYSTACK_DVA_ENABLED === 'false'
  if (!dvaEnabled || dvaDisabledByEnv) {
    return { error: NextResponse.json({ error: 'Virtual accounts are not enabled' }, { status: 404 }) }
  }
  return { session }
}

function toSafeVirtualAccount(row: Record<string, unknown> | null | undefined): SafeVirtualAccount | null {
  if (!row) return null
  return {
    bank_name: typeof row.bank_name === 'string' ? row.bank_name : null,
    account_name: typeof row.account_name === 'string' ? row.account_name : null,
    account_number: typeof row.account_number === 'string' ? row.account_number : null,
    provider_slug: typeof row.provider_slug === 'string' ? row.provider_slug : null,
    status: typeof row.status === 'string' ? row.status : 'PENDING',
    consented_at: typeof row.consented_at === 'string' ? row.consented_at : null,
    failure_reason: typeof row.failure_reason === 'string' ? row.failure_reason : null,
  }
}

export async function GET() {
  const gate = await customerGate()
  if ('error' in gate) return gate.error
  const db = createSupabaseAdmin()
  const { data: customer } = await db.from('customers').select('id').eq('phone', gate.session.phone).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const { data } = await db.from('customer_virtual_accounts')
    .select('bank_name, account_name, account_number, provider_slug, status, consented_at, failure_reason')
    .eq('customer_id', customer.id).maybeSingle()
  return NextResponse.json({ virtual_account: toSafeVirtualAccount(data as Record<string, unknown> | null) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const gate = await customerGate()
  if ('error' in gate) return gate.error
  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid identity details' }, { status: 400 })
  const db = createSupabaseAdmin()
  const { data: customer } = await db.from('customers').select('id, name, email, phone').eq('phone', gate.session.phone).maybeSingle()
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const fallbackEmail = `${customer.id}@customers.lumexfud.com.ng`
  const email = typeof customer.email === 'string' && customer.email.includes('@') ? customer.email : fallbackEmail
  const names = typeof customer.name === 'string' && customer.name.trim()
    ? customer.name.trim().split(/\s+/)
    : ['LumeX', 'Customer']
  const firstName = names[0] ?? 'LumeX'
  const lastName = names.slice(1).join(' ') || 'Customer'
  const existing = await db.from('customer_virtual_accounts').select('*').eq('customer_id', customer.id).maybeSingle()
  if (existing.data?.status === 'ACTIVE') return NextResponse.json({ virtual_account: toSafeVirtualAccount(existing.data as Record<string, unknown>) })
  if (existing.data?.status === 'PROVISIONING') return NextResponse.json({ error: 'Account assignment is already in progress' }, { status: 409 })
  const assignmentReference = crypto.randomUUID()
  const row = {
    customer_id: customer.id, consented_at: new Date().toISOString(), consent_version: 'paystack-dva-v1',
    status: 'PROVISIONING', assignment_reference: assignmentReference,
    identity_snapshot: maskVerificationIdentity({ type: parsed.data.identity_type, value: parsed.data.identity_number }),
  }
  const claim = existing.data
    ? await db.from('customer_virtual_accounts').update(row).eq('customer_id', customer.id).neq('status', 'PROVISIONING').select('*').maybeSingle()
    : await db.from('customer_virtual_accounts').insert(row).select('*').maybeSingle()
  if (!claim.data) return NextResponse.json({ error: 'Account assignment is already in progress' }, { status: 409 })
  try {
    let customerCode = claim.data.paystack_customer_code as string | null
    if (!customerCode) {
      try {
        const created = await createPaystackCustomer({ email, firstName, lastName, phone: customer.phone })
        customerCode = created.customer_code
      } catch {
        customerCode = (await fetchPaystackCustomer(email)).customer_code
      }
      await db.from('customer_virtual_accounts').update({ paystack_customer_code: customerCode }).eq('customer_id', customer.id).eq('assignment_reference', assignmentReference)
    }
    const assigned = await assignDedicatedAccount({
      email, firstName, lastName, phone: customer.phone,
      preferredBank: process.env.PAYSTACK_DVA_PREFERRED_BANK,
      bvn: parsed.data.identity_type === 'bvn' ? parsed.data.identity_number : undefined,
    })
    if (assigned?.account_number) {
      const active = {
        status: 'ACTIVE', bank_name: assigned.bank.name, provider_slug: assigned.bank.slug,
        account_name: assigned.account_name, account_number: assigned.account_number, failure_reason: null,
        paystack_customer_code: assigned.customer?.customer_code ?? customerCode, updated_at: new Date().toISOString(),
      }
      await db.from('customer_virtual_accounts').update(active).eq('customer_id', customer.id).eq('assignment_reference', assignmentReference)
      return NextResponse.json({ virtual_account: toSafeVirtualAccount({ ...claim.data, ...active }) }, { status: 201 })
    }
    return NextResponse.json({ status: 'PENDING' }, { status: 202 })
  } catch (error) {
    await db.from('customer_virtual_accounts').update({ status: 'FAILED', failure_reason: error instanceof Error ? error.message.slice(0, 300) : 'Assignment failed', updated_at: new Date().toISOString() })
      .eq('customer_id', customer.id).eq('assignment_reference', assignmentReference)
    return NextResponse.json({ error: 'Paystack could not assign an account' }, { status: 502 })
  }
}

export async function PUT() {
  const gate = await customerGate()
  if ('error' in gate) return gate.error
  const db = createSupabaseAdmin()
  const { data: customer } = await db.from('customers').select('id').eq('phone', gate.session.phone).maybeSingle()
  const { data: account } = await db.from('customer_virtual_accounts').select('account_number, provider_slug').eq('customer_id', customer?.id).eq('status', 'ACTIVE').maybeSingle()
  if (!account?.account_number || !account.provider_slug) return NextResponse.json({ error: 'Active account not found' }, { status: 404 })
  await requeryDedicatedAccount(account.account_number, account.provider_slug)
  return NextResponse.json({ status: 'REQUERY_STARTED' }, { status: 202 })
}
