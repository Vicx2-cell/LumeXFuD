import { redirect } from 'next/navigation'

export default async function LegacyVendorFollowersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/vendor-followers/${id}`)
}
