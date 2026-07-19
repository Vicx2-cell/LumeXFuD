import { redirect } from 'next/navigation'

export default async function LegacyVendorFollowingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/vendor-following/${id}`)
}
