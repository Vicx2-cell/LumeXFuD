import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BadgeCheck, Heart, MessageCircle, Repeat2 } from 'lucide-react'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BrandLogo } from '@/components/brand-logo'
import { DefaultAvatar } from '@/components/default-avatar'

export const dynamic = 'force-dynamic'

export default async function FeedProfilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params
  const db = createSupabaseAdmin()
  const { data: profile } = await db
    .from('social_profiles')
    .select('id, display_name, handle, bio, avatar_url, profile_kind, is_verified, is_system_account, official_badge_kind, created_at')
    .eq('id', profileId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!profile) notFound()

  const [{ count: followers }, { count: following }, { data: posts }] = await Promise.all([
    db.from('follows').select('id', { count: 'exact', head: true }).eq('followed_profile_id', profileId),
    db.from('follows').select('id', { count: 'exact', head: true }).eq('follower_profile_id', profileId),
    db.from('posts')
      .select('id, body, view_count, like_count, reply_count, repost_count, published_at, created_at, post_media(public_url, media_kind, sort_order)')
      .eq('author_profile_id', profileId)
      .eq('status', 'published')
      .is('deleted_at', null)
      .order('published_at', { ascending: false })
      .limit(50),
  ])

  const official = Boolean(profile.is_system_account || profile.official_badge_kind === 'official')
  const joined = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(profile.created_at))

  return (
    <main className="min-h-screen bg-[#090909] pb-24 text-[#f7f2ea]">
      <div className="mx-auto min-h-screen w-full max-w-2xl border-x border-white/6">
        <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/7 bg-[#090909]/90 px-4 py-3 backdrop-blur-xl">
          <Link href="/feed-v2" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/7" aria-label="Back to feed"><ArrowLeft size={19} /></Link>
          <div><h1 className="font-semibold">{profile.display_name}</h1><p className="text-xs text-white/40">{posts?.length ?? 0} posts</p></div>
        </header>

        <section className="border-b border-white/7 px-5 py-6">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-2xl font-bold">{profile.display_name}</h2>{(official || profile.is_verified) ? <BadgeCheck size={20} className={official ? 'text-[#f5a623]' : 'text-sky-400'} /> : null}</div><p className="mt-1 text-sm text-white/48">@{profile.handle}</p></div>
            <div className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-white/6">{official ? <BrandLogo size={80} rounded={9999} /> : profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={30} />}</div>
          </div>
          <p className="mt-5 whitespace-pre-wrap text-[15px] leading-6 text-white/88">{profile.bio?.trim() || (official ? 'The official LumeX Fud account.' : 'Sharing food and campus moments on LumeX Fud.')}</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span><b>{followers ?? 0}</b> <span className="text-white/45">followers</span></span><span><b>{following ?? 0}</b> <span className="text-white/45">following</span></span><span className="text-white/38">Joined {joined}</span></div>
        </section>

        <div className="border-b border-white/7 py-4 text-center text-sm font-semibold"><span className="border-b-2 border-[#f5a623] px-8 pb-4">Posts</span></div>
        <section>
          {!posts?.length ? <div className="px-5 py-16 text-center text-sm text-white/42">No posts yet.</div> : posts.map((post) => {
            const media = [...(post.post_media ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order))[0]
            return <article key={post.id} className="border-b border-white/7 px-5 py-5"><div className="flex gap-3"><div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/6">{official ? <BrandLogo size={40} rounded={9999} /> : profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={18} />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm"><b>{profile.display_name}</b><span className="truncate text-white/38">@{profile.handle}</span><span className="ml-auto text-white/32">{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(post.published_at ?? post.created_at))}</span></div>{post.body ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-6 text-white/90">{post.body}</p> : null}{media?.public_url ? <div className="mt-3 overflow-hidden rounded-2xl border border-white/8 bg-black">{media.media_kind === 'video' ? <video src={media.public_url} controls playsInline preload="metadata" className="max-h-[560px] w-full object-contain" /> : <img src={media.public_url} alt="" className="max-h-[560px] w-full object-cover" />}</div> : null}<div className="mt-4 flex items-center gap-6 text-xs text-white/42"><span className="inline-flex items-center gap-1.5"><Heart size={15} />{post.like_count}</span><span className="inline-flex items-center gap-1.5"><MessageCircle size={15} />{post.reply_count}</span><span className="inline-flex items-center gap-1.5"><Repeat2 size={15} />{post.repost_count}</span><span className="ml-auto">{post.view_count} views</span></div></div></div></article>
          })}
        </section>
      </div>
    </main>
  )
}
