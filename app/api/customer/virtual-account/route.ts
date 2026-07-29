import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { assignDedicatedAccount, createPaystackCustomer, fetchPaystackCustomer, maskIdentity, requeryDedicatedAccount } from '@/lib/paystack/virtual-accounts'

const inputSchema = z.object({
  consent: z.literal(true),
  account_number: z.string().regex(/^\d{10}$/).optional(),
  bank_code: z.string().regex(/^\d{3}$/).optional(),
  bvn: z.string().regex(/^\d{11}$/).optional(),
}).superRefine((v, ctx) => {
  if (process.env.PAYSTACK_DVA_COMPLIANCE_REQUIRED === 'true' && (!v.account_number || !v.bank_code || !v.bvn)) {
    ctx.addIssue({ code: 'custom', message: 'Provider identity fields are required for this business category' })
  }
})

async function customerGate() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return { error: NextResponse.json({ error: 'Customer authentication required' }, { status: 401 }) }
  if (!(await getFeature('customer_virtual_accounts')) || process.env.PAYSTACK_DVA_ENABLED !== 'true') {
    return { error: NextResponse.json({ error: 'Virtual accounts are not enabled' }, { status: 404 }) }
  }
  return { session }
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
  return NextResponse.json({ virtual_account: data ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const gate = await customerGate()
  if ('error' in gate) return gate.error
  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid identity details' }, { status: 400 })
  const db = createSupabaseAdmin()
  const { data: customer } = await db.from('customers').select('id, name, email, phone, email_verified').eq('phone', gate.session.phone).maybeSingle()
  if (!customer || !customer.email || !customer.email_verified || !customer.name?.trim()) {
    return NextResponse.json({ error: 'A verified email and full name are required' }, { status: 409 })
  }
  const names = customer.name.trim().split(/\s+/)
  if (names.length < 2) return NextResponse.json({ error: 'Add your full legal name before continuing' }, { status: 409 })
  const existing = await db.from('customer_virtual_accounts').select('*').eq('customer_id', customer.id).maybeSingle()
  if (existing.data?.status === 'ACTIVE') return NextResponse.json({ virtual_account: existing.data })
  if (existing.data?.status === 'PROVISIONING') return NextResponse.json({ error: 'Account assignment is already in progress' }, { status: 409 })
  const assignmentReference = crypto.randomUUID()
  const row = {
    customer_id: customer.id, consented_at: new Date().toISOString(), consent_version: 'paystack-dva-v1',
    status: 'PROVISIONING', assignment_reference: assignmentReference,
    identity_snapshot: maskIdentity({ accountNumber: parsed.data.account_number, bankCode: parsed.data.bank_code }),
  }
  const claim = existing.data
    ? await db.from('customer_virtual_accounts').update(row).eq('customer_id', customer.id).neq('status', 'PROVISIONING').select('*').maybeSingle()
    : await db.from('customer_virtual_accounts').insert(row).select('*').maybeSingle()
  if (!claim.data) return NextResponse.json({ error: 'Account assignment is already in progress' }, { status: 409 })
  try {
    let customerCode = claim.data.paystack_customer_code as string | null
    if (!customerCode) {
      try {
        const created = await createPaystackCustomer({ email: customer.email, firstName: names[0], lastName: names.slice(1).join(' '), phone: customer.phone })
        customerCode = created.customer_code
      } catch {
        customerCode = (await fetchPaystackCustomer(customer.email)).customer_code
      }
      await db.from('customer_virtual_accounts').update({ paystack_customer_code: customerCode }).eq('customer_id', customer.id).eq('assignment_reference', assignmentReference)
    }
    const assigned = await assignDedicatedAccount({
      email: customer.email, firstName: names[0], lastName: names.slice(1).join(' '), phone: customer.phone,
      preferredBank: process.env.PAYSTACK_DVA_PREFERRED_BANK, accountNumber: parsed.data.account_number,
      bankCode: parsed.data.bank_code, bvn: parsed.data.bvn,
    })
    if (assigned?.account_number) {
      const active = {
        status: 'ACTIVE', bank_name: assigned.bank.name, provider_slug: assigned.bank.slug,
        account_name: assigned.account_name, account_number: assigned.account_number, failure_reason: null,
        paystack_customer_code: assigned.customer?.customer_code ?? customerCode, updated_at: new Date().toISOString(),
      }
      await db.from('customer_virtual_accounts').update(active).eq('customer_id', customer.id).eq('assignment_reference', assignmentReference)
      return NextResponse.json({ virtual_account: active }, { status: 201 })
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
