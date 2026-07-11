import { z } from 'zod'

const urlOrNull = z.string().url().max(500)
const safeText = z.string().trim().max(5000)

export const feedTabKeySchema = z.enum(['for_you', 'following', 'nearby', 'deals', 'trending'])

export const feedComposerMediaSchema = z.object({
  kind: z.enum(['image', 'video', 'embed']),
  storage_path: z.string().max(500).optional(),
  public_url: urlOrNull.optional(),
  provider_name: z.string().max(40).optional(),
  provider_url: urlOrNull.optional(),
  mime_type: z.string().max(120).optional(),
  duration_seconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  width: z.number().int().min(1).max(10_000).optional(),
  height: z.number().int().min(1).max(10_000).optional(),
  alt_text: z.string().max(280).optional(),
  caption: z.string().max(500).optional(),
  sort_order: z.number().int().min(0).max(100).optional().default(0),
  is_primary: z.boolean().optional().default(false),
})

export const feedComposerMenuItemSchema = z.object({
  menu_item_id: z.string().uuid(),
  is_primary: z.boolean().optional().default(false),
  order_label: z.string().max(120).optional(),
})

export const feedComposerPromotionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  campaign_price_kobo: z.number().int().min(0).max(1_000_000_000),
  landing_url: z.string().url().max(500).optional(),
  starts_at: z.string().datetime({ offset: true }).optional(),
  ends_at: z.string().datetime({ offset: true }).optional(),
})

export const feedComposerInput = z.object({
  draft_id: z.string().uuid().optional(),
  body: safeText.optional(),
  content_warning: z.string().trim().max(240).optional(),
  visibility: z.enum(['public', 'followers', 'private', 'unlisted']).default('public'),
  audience_scope: z.enum(['all', 'customers', 'vendors', 'riders', 'staff']).default('all'),
  post_kind: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'TIKTOK', 'MENU_ITEM', 'PROMOTION', 'QUOTE', 'REPOST', 'POLL']).default('TEXT'),
  campus_id: z.string().uuid().optional(),
  zone_id: z.string().uuid().optional(),
  location_text: z.string().max(200).optional(),
  scheduled_for: z.string().datetime({ offset: true }).nullable().optional(),
  hashtags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  mentions: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  media: z.array(feedComposerMediaSchema).max(12).default([]),
  menu_items: z.array(feedComposerMenuItemSchema).max(12).default([]),
  promotion: feedComposerPromotionSchema.optional(),
  related_menu_item_id: z.string().uuid().optional(),
  provider_connection_id: z.string().uuid().optional(),
  provider_video_id: z.string().uuid().optional(),
  quoted_post_id: z.string().uuid().optional(),
  reposted_post_id: z.string().uuid().optional(),
  content_type_label: z.string().max(60).optional(),
})

export const feedComposerActionInput = feedComposerInput.extend({
  mode: z.enum(['draft', 'publish']).default('publish'),
})
export type FeedComposerActionInput = z.infer<typeof feedComposerActionInput>

export const feedUploadInput = z.object({
  media_kind: z.enum(['image', 'video']),
  duration_seconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  alt_text: z.string().max(280).optional(),
}).strict()

export const feedEventInput = z.object({
  event_key: z.string().trim().min(8).max(120),
  post_id: z.string().uuid().optional(),
  viewer_profile_id: z.string().uuid().optional(),
  event_type: z.enum([
    'impression', 'qualified_impression', 'video_start', 'video_25', 'video_50',
    'video_75', 'video_100', 'rewatch', 'dwell', 'like', 'unlike', 'reply',
    'repost', 'save', 'share', 'profile_visit', 'follow', 'menu_click',
    'add_to_cart', 'checkout_start', 'completed_order', 'refunded_order',
    'cancelled_order', 'report', 'not_interested', 'hide_creator', 'block',
  ]),
  source_tab: feedTabKeySchema.optional(),
  amount_kobo: z.number().int().min(0).max(1_000_000_000).default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const feedEventBatchInput = z.object({
  batch_key: z.string().trim().min(8).max(120),
  source_tab: feedTabKeySchema.optional(),
  events: z.array(feedEventInput).min(1).max(50),
})

export const rankingSimulationInput = z.object({
  viewer_profile_id: z.string().uuid().optional(),
  tab: feedTabKeySchema.optional(),
  weights: z.record(z.string(), z.number()).optional(),
})

export const feedToggleInput = z.object({
  enabled: z.boolean().default(true),
})

export const feedReplyInput = z.object({
  body: z.string().trim().min(1).max(2000),
  parent_reply_id: z.string().uuid().optional(),
})

export const feedReportInput = z.object({
  report_type: z.enum(['spam', 'harassment', 'impersonation', 'misleading_food', 'copyright', 'privacy', 'explicit', 'dangerous', 'scam', 'prohibited_goods', 'fake_promotion', 'other']),
  reason: z.string().trim().min(3).max(1000),
})

export const feedFeedbackInput = z.object({
  kind: z.enum(['not_interested', 'hide_creator']),
})
