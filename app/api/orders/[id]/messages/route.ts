import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { sanitize } from '@/lib/security'
import type { OrderStatus } from '@/types'

const PROFANITY = ['fuck', 'shit', 'bastard', 'idiot', 'stupid']

type SenderType = 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'ADMIN'
type RecipientType = 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'ADMIN'

const ALLOWED_WINDOWS: Array<{ sender: SenderType; recipient: RecipientType; statuses: OrderStatus[] }> = [
  { sender: 'CUSTOMER', recipient: 'VENDOR', statuses: ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY'] },
  { sender: 'CUSTOMER', recipient: 'RIDER', statuses: ['PICKED_UP', 'DELIVERED'] },
  { sender: 'VENDOR', recipient: 'CUSTOMER', statuses: ['VENDOR_ACCEPTED', 'PREPARING', 'READY'] },
  { sender: 'RIDER', recipient: 'CUSTOMER', statuses: ['RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED'] },
  { sender: 'CUSTOMER', recipient: 'ADMIN', statuses: ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'DISPUTED'] },
  { sender: 'ADMIN', recipient: 'CUSTOMER', statuses: ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'CANCELLED'] },
  { sender: 'ADMIN', recipient: 'VENDOR', statuses: ['PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'CANCELLED'] },
  { sender: 'ADMIN', recipient: 'RIDER', statuses: ['RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED'] },
]

function isWindowAllowed(sender: SenderType, recipient: RecipientType, status: OrderStatus): boolean {
  return ALLOWED_WINDOWS.some(
    (w) => w.sender === sender && w.recipient === recipient && (w.statuses as string[]).includes(status)
  )
}

function roleToSenderType(role: string): SenderType | null {
  const map: Record<string, SenderType> = {
    customer: 'CUSTOMER',
    vendor: 'VENDOR',
    rider: 'RIDER',
    admin: 'ADMIN',
    super_admin: 'ADMIN',
  }
  return map[role] ?? null
}

function hasProfanity(text: string): boolean {
  const lower = text.toLowerCase()
  return PROFANITY.some((word) => lower.includes(word))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { message, recipient_type } = body as { message: string; recipient_type: string }

  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 300) {
    return NextResponse.json({ error: 'Message must be 1-300 characters' }, { status: 400 })
  }
  if (!['VENDOR', 'RIDER', 'CUSTOMER', 'ADMIN'].includes(recipient_type)) {
    return NextResponse.json({ error: 'Invalid recipient_type' }, { status: 400 })
  }

  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, status, customer_id, vendor_id, rider_id')
    .eq('id', id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Verify sender has access to this order
  let senderId = session.phone
  const senderType = roleToSenderType(session.role)
  if (!senderType) return NextResponse.json({ error: 'Invalid role' }, { status: 403 })

  // Customer ownership check
  if (session.role === 'customer') {
    const { data: customer } = await db.from('customers').select('id').eq('phone', session.phone).single()
    if (!customer || customer.id !== order.customer_id) {
      return NextResponse.json({ error: 'Not your order' }, { status: 403 })
    }
    senderId = customer.id as string
  }

  // Check messaging window
  if (!isWindowAllowed(senderType, recipient_type as RecipientType, order.status as OrderStatus)) {
    return NextResponse.json({ error: 'Messaging not allowed at this order stage' }, { status: 403 })
  }

  // Rate limit: 10 messages per user per order
  const { count } = await db
    .from('order_messages')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', id)
    .eq('sender_id', senderId)

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Message limit reached for this order' }, { status: 429 })
  }

  // Sanitize
  const cleaned = sanitize(message)
  const flagged = hasProfanity(cleaned)

  const { data: inserted } = await db
    .from('order_messages')
    .insert({
      order_id: id,
      sender_id: senderId,
      sender_type: senderType,
      recipient_type: recipient_type as RecipientType,
      message: cleaned,
      flagged_profanity: flagged,
    })
    .select('id, sender_type, recipient_type, message, created_at')
    .single()

  return NextResponse.json({ message: inserted })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, customer_id, vendor_id, rider_id')
    .eq('id', id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership check for customers
  if (session.role === 'customer') {
    const { data: customer } = await db.from('customers').select('id').eq('phone', session.phone).single()
    if (!customer || customer.id !== order.customer_id) {
      return NextResponse.json({ error: 'Not your order' }, { status: 403 })
    }
  }

  const { data: messages } = await db
    .from('order_messages')
    .select('id, sender_id, sender_type, recipient_type, message, flagged_profanity, read_at, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ messages: messages ?? [] })
}
