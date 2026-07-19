import { RelationshipList } from '@/app/vendor/[id]/relationship-list'

export const dynamic = 'force-dynamic'

export default async function VendorFollowersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ q?: string; cursor?: string }>
}) {
  const { id } = await params
  return (
    <main className="lx-page pb-24">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <RelationshipList vendorId={id} direction="followers" searchParams={searchParams} />
      </div>
    </main>
  )
}
