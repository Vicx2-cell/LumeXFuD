import { notFound } from 'next/navigation'
import { getFeature } from '@/lib/features'
import { ApplyForm } from './apply-form'

const validKinds = new Set(['vendor', 'rider'])

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ kind: string }>
}) {
  const { kind } = await params
  if (!validKinds.has(kind)) notFound()
  if (!(await getFeature('partner_applications'))) notFound()

  return <ApplyForm kind={kind as 'vendor' | 'rider'} />
}
