import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSession, setCookieOptions } from '@/lib/session'
import { sessionCookieName } from '@/lib/session-cookie'
import { createSupabaseAdmin } from '@/lib/supabase/server'

function isProdLike() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

function makeQaPhone() {
  const suffix = crypto.randomInt(0, 100_000_000).toString().padStart(8, '0')
  return `+23480${suffix}`
}

export async function GET(req: NextRequest) {
  if (isProdLike()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const db = createSupabaseAdmin()
  const url = new URL(req.url)
  const phone = url.searchParams.get('phone')?.trim() || makeQaPhone()
  const name = url.searchParams.get('name')?.trim() || 'QA Customer'
  const inspect = url.searchParams.get('inspect') === '1'

  const vendorPhone = '+2348099000001'
  const vendorShop = 'QA Feed Kitchen'
  const vendorOwner = 'QA Feed Vendor'
  const vendorHandle = 'qa-feed-kitchen'

  const { data: vendorExisting } = await db
    .from('vendors')
    .select('id, phone, shop_name, owner_name')
    .eq('phone', vendorPhone)
    .maybeSingle()

  let vendorId = vendorExisting?.id as string | undefined
  if (!vendorId) {
    const { data: created, error: vendorError } = await db
      .from('vendors')
      .insert({
        phone: vendorPhone,
        name: vendorShop,
        business_name: vendorShop,
        shop_name: vendorShop,
        owner_name: vendorOwner,
        owner_phone: vendorPhone,
        category: 'Other',
        merchant_category: 'restaurant',
        description: 'QA feed fixture vendor',
        login_pin_hash: null,
        pin_reset_pending: false,
        whatsapp_verified: true,
        business_verified: true,
        created_by_admin: false,
        approval_state: 'approved',
        id_verified: true,
        site_inspected: true,
        is_active: true,
        approved_at: new Date().toISOString(),
        approved_by: 'dev-qa',
      })
      .select('id')
      .single()
    if (vendorError || !created) {
      console.error('[dev/qa/customer-session] vendor create error', vendorError)
      return NextResponse.json({ error: 'Could not prepare QA vendor' }, { status: 500 })
    }
    vendorId = created.id as string
  }

  const { data: vendorProfileExisting } = await db
    .from('social_profiles')
    .select('id')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  let vendorProfileId = vendorProfileExisting?.id as string | undefined
  if (!vendorProfileId) {
    const { data: created, error: profileError } = await db
      .from('social_profiles')
      .insert({
        vendor_id: vendorId,
        profile_kind: 'vendor',
        handle: vendorHandle,
        display_name: vendorShop,
        premium_verified: true,
        is_verified: true,
        is_system_account: false,
      })
      .select('id')
      .single()
    if (profileError || !created) {
      console.error('[dev/qa/customer-session] vendor profile create error', profileError)
      return NextResponse.json({ error: 'Could not prepare QA vendor profile' }, { status: 500 })
    }
    vendorProfileId = created.id as string
  }
  if (!vendorProfileId) {
    return NextResponse.json({ error: 'Could not prepare QA vendor profile' }, { status: 500 })
  }

  const qaMenuItems = [
    {
      name: 'QA Jollof Rice',
      image_url: '/hero.jpg',
      is_available: true,
      price_kobo: 380_000,
      category: 'RICE',
      body: 'QA feed fixture: live image and available order action.',
      postKind: 'MENU_ITEM' as const,
      postBody: 'QA feed fixture: live menu image',
      postMedia: null,
      postMenuBody: 'Primary image item',
      isPrimary: true,
    },
    {
      name: 'QA Plain Rice',
      image_url: null,
      is_available: false,
      price_kobo: 380_000,
      category: 'RICE',
      body: 'QA feed fixture: missing image and unavailable order action.',
      postKind: 'MENU_ITEM' as const,
      postBody: 'QA feed fixture: placeholder item',
      postMedia: null,
      postMenuBody: 'Placeholder item',
      isPrimary: true,
    },
  ]

  const menuIds: string[] = []
  for (const item of qaMenuItems) {
    const { data: existingMenu } = await db
      .from('menu_items')
      .select('id')
      .eq('vendor_id', vendorId)
      .eq('name', item.name)
      .maybeSingle()
    if (existingMenu?.id) {
      menuIds.push(existingMenu.id as string)
      continue
    }
    const { data: createdMenu, error: menuError } = await db
      .from('menu_items')
      .insert({
        vendor_id: vendorId,
        name: item.name,
        description: item.body,
        price_kobo: item.price_kobo,
        price: item.price_kobo,
        image_url: item.image_url,
        category: item.category,
        product_category: 'meal',
        prescription_required: false,
        is_available: item.is_available,
        display_order: menuIds.length,
      })
      .select('id')
      .single()
    if (menuError || !createdMenu) {
      console.error('[dev/qa/customer-session] menu item create error', menuError)
      return NextResponse.json({ error: 'Could not prepare QA menu items' }, { status: 500 })
    }
    menuIds.push(createdMenu.id as string)
  }
  const primaryMenuId = menuIds[0]
  const placeholderMenuId = menuIds[1]
  if (!primaryMenuId || !placeholderMenuId) {
    return NextResponse.json({ error: 'Could not prepare QA menu items' }, { status: 500 })
  }

  const menuPrimaryBody = 'QA feed fixture: live menu image'
  const menuPlaceholderBody = 'QA feed fixture: placeholder item'

  const { data: menuPostExisting } = await db
    .from('posts')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('post_kind', 'MENU_ITEM')
    .eq('body', menuPrimaryBody)
    .maybeSingle()
  if (!menuPostExisting?.id) {
    const { data: post, error: postError } = await db
      .from('posts')
      .insert({
        author_profile_id: vendorProfileId,
        vendor_id: vendorId,
        related_menu_item_id: primaryMenuId,
        post_kind: 'MENU_ITEM',
        status: 'published',
        visibility: 'public',
        audience_scope: 'all',
        body: menuPrimaryBody,
        hashtags_cached: ['jollof', 'deal', 'lunch'],
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (postError || !post) {
      console.error('[dev/qa/customer-session] primary post create error', postError)
      return NextResponse.json({ error: 'Could not prepare QA menu post' }, { status: 500 })
    }
    await db.from('post_menu_items').insert({
      post_id: post.id,
      menu_item_id: primaryMenuId,
      menu_item_name_snapshot: qaMenuItems[0].name,
      menu_item_price_kobo_snapshot: qaMenuItems[0].price_kobo,
      menu_item_image_url_snapshot: qaMenuItems[0].image_url,
      is_primary: true,
      is_available_snapshot: qaMenuItems[0].is_available,
    })
  } else {
    await db.from('posts').update({ related_menu_item_id: primaryMenuId }).eq('id', menuPostExisting.id)
  }

  const { data: placeholderPostExisting } = await db
    .from('posts')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('post_kind', 'MENU_ITEM')
    .eq('body', menuPlaceholderBody)
    .maybeSingle()
  if (!placeholderPostExisting?.id) {
    const { data: post, error: postError } = await db
      .from('posts')
      .insert({
        author_profile_id: vendorProfileId,
        vendor_id: vendorId,
        related_menu_item_id: placeholderMenuId,
        post_kind: 'MENU_ITEM',
        status: 'published',
        visibility: 'public',
        audience_scope: 'all',
        body: menuPlaceholderBody,
        hashtags_cached: ['placeholder', 'menu', 'noimage'],
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (postError || !post) {
      console.error('[dev/qa/customer-session] placeholder post create error', postError)
      return NextResponse.json({ error: 'Could not prepare QA placeholder post' }, { status: 500 })
    }
    await db.from('post_menu_items').insert({
      post_id: post.id,
      menu_item_id: placeholderMenuId,
      menu_item_name_snapshot: qaMenuItems[1].name,
      menu_item_price_kobo_snapshot: qaMenuItems[1].price_kobo,
      menu_item_image_url_snapshot: qaMenuItems[1].image_url,
      is_primary: true,
      is_available_snapshot: qaMenuItems[1].is_available,
    })
  } else {
    await db.from('posts').update({ related_menu_item_id: placeholderMenuId }).eq('id', placeholderPostExisting.id)
  }

  const { data: existing, error: findError } = await db
    .from('customers')
    .select('id, phone')
    .eq('phone', phone)
    .maybeSingle()

  if (findError) {
    console.error('[dev/qa/customer-session] lookup error', findError)
    return NextResponse.json({ error: 'Could not prepare QA account' }, { status: 500 })
  }

  let customerId = existing?.id as string | undefined
  if (!customerId) {
    const { data: created, error: createError } = await db
      .from('customers')
      .insert({ phone, name })
      .select('id')
      .single()

    if (createError || !created) {
      console.error('[dev/qa/customer-session] create error', createError)
      return NextResponse.json({ error: 'Could not create QA account' }, { status: 500 })
    }

    customerId = created.id as string
  }

  const { token } = await createSession(customerId, phone, 'customer')

  if (inspect) {
    const [vendors, customers, menus, posts, feedRows, postMenus, promos, media] = await Promise.all([
      db.from('vendors').select('id', { count: 'exact', head: true }).eq('phone', vendorPhone),
      db.from('customers').select('id', { count: 'exact', head: true }).eq('phone', phone),
      db.from('menu_items').select('id', { count: 'exact', head: true }).eq('vendor_id', vendorId),
      db.from('posts').select('id', { count: 'exact', head: true }).eq('vendor_id', vendorId).eq('status', 'published'),
      db.from('posts')
        .select('id, author_profile_id, vendor_id, zone_id, campus_id, post_kind, status, visibility, body, content_warning, location_text, hashtags_cached, published_at, created_at, view_count, like_count, reply_count, repost_count, bookmark_count, share_count, menu_click_count, cart_add_count, order_count, revenue_kobo, watch_time_ms, completion_rate, location_relevance_score, order_conversion_count, safe_rank_score, official_feed_posts(id, area_scope, area_id, collection_type, source_type, source_id, generation_reason, selection_metadata, is_auto_published, approved_at, approved_by, archived_at, archived_reason), post_media(id, media_kind, public_url, provider_name, provider_url, mime_type, alt_text, caption, sort_order, is_primary), post_menu_items(id, menu_item_id, menu_item_name_snapshot, menu_item_price_kobo_snapshot, is_available_snapshot, is_primary, menu_item_image_url_snapshot)')
        .eq('status', 'published')
        .is('deleted_at', null)
        .limit(200),
      db.from('post_menu_items').select('id', { count: 'exact', head: true }),
      db.from('post_promotions').select('id', { count: 'exact', head: true }),
      db.from('post_media').select('id', { count: 'exact', head: true }),
    ])
    return NextResponse.json({
      seeded: true,
      vendorPhone,
      customerPhone: phone,
      counts: {
        vendors: vendors.count ?? 0,
        customers: customers.count ?? 0,
        menus: menus.count ?? 0,
        posts: posts.count ?? 0,
        feedRows: feedRows.data?.length ?? 0,
        postMenus: postMenus.count ?? 0,
        promotions: promos.count ?? 0,
        media: media.count ?? 0,
      },
    })
  }

  const res = NextResponse.redirect(new URL('/feed-v2', req.url))
  res.cookies.set(sessionCookieName(), token, setCookieOptions('customer'))
  res.headers.set('x-lumex-qa-phone', phone)
  res.headers.set('x-lumex-qa-session', 'customer')
  res.headers.set('x-lumex-qa-vendor', vendorPhone)
  return res
}
