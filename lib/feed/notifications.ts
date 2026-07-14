import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notifyInApp, roleToUserType, type NotifUserType } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/push'
import { safeNormalizePhone } from '@/lib/phone'

type SocialRecipient = {
  customer_id: string | null
  vendor_id: string | null
  rider_id: string | null
  admin_id: string | null
}

export type FeedRecipient = {
  userId: string
  userType: NotifUserType
}

function profileToRecipient(profile: SocialRecipient | null | undefined): FeedRecipient | null {
  if (!profile) return null
  const userId = profile.customer_id ?? profile.vendor_id ?? profile.rider_id ?? profile.admin_id ?? null
  if (!userId) return null
  const userType =
    profile.vendor_id ? roleToUserType('vendor')
      : profile.rider_id ? roleToUserType('rider')
        : profile.admin_id ? roleToUserType('admin')
          : roleToUserType('customer')
  return { userId, userType }
}

export async function loadRecipientsFromProfileIds(profileIds: string[]): Promise<FeedRecipient[]> {
  if (profileIds.length === 0) return []
  const db = createSupabaseAdmin()
  const { data } = await db
    .from('social_profiles')
    .select('customer_id, vendor_id, rider_id, admin_id')
    .in('id', profileIds)
  return Array.from(new Map((data ?? [])
    .map((row) => profileToRecipient(row as SocialRecipient))
    .filter((row): row is FeedRecipient => Boolean(row))
    .map((row) => [row.userId, row] as const)).values())
}

export async function loadAdminRecipients(): Promise<FeedRecipient[]> {
  const db = createSupabaseAdmin()
  const [adminsResult, staffResult] = await Promise.all([
    db.from('admins').select('id, phone'),
    db.from('customers').select('id, phone').in('phone', [
      safeNormalizePhone(process.env.ADMIN_PHONE),
      safeNormalizePhone(process.env.SUPER_ADMIN_PHONE),
    ].filter((phone): phone is string => Boolean(phone))),
  ])

  const recipients = [
    ...(adminsResult.data ?? []).map((row) => ({ userId: String((row as { id: string }).id), userType: roleToUserType('admin') })),
    ...(staffResult.data ?? []).map((row) => ({ userId: String((row as { id: string }).id), userType: roleToUserType('super_admin') })),
  ]

  return Array.from(new Map(recipients.map((row) => [row.userId, row] as const)).values())
}

export async function notifyFeedRecipient(params: {
  recipient: FeedRecipient
  title: string
  body: string
  link?: string
  template: string
  tag?: string
}) {
  const { recipient, title, body, link, template, tag } = params
  const db = createSupabaseAdmin()
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('notifications')
    .select('id')
    .eq('user_id', recipient.userId)
    .eq('channel', 'in_app')
    .eq('template', template)
    .eq('title', title)
    .gte('created_at', cutoff)
    .limit(1)

  if ((recent ?? []).length > 0) return

  await notifyInApp({
    userId: recipient.userId,
    userType: recipient.userType,
    title,
    body,
    link,
    template,
  })

  void sendPushToUser(recipient.userId, { title, body, url: link, tag }).catch(() => {})
}

export async function notifyFeedRecipients(params: {
  recipients: FeedRecipient[]
  title: string
  body: string
  link?: string
  template: string
  tag?: string
}) {
  await Promise.allSettled(
    params.recipients.map((recipient) =>
      notifyFeedRecipient({
        recipient,
        title: params.title,
        body: params.body,
        link: params.link,
        template: params.template,
        tag: params.tag,
      }),
    ),
  )
}
