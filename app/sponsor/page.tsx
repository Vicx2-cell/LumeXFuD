import Link from 'next/link'

export default function SponsorPage() {
  return (
    <main className="lx-page min-h-dvh flex items-center justify-center px-5 text-white">
      <section className="max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <p className="text-xs uppercase tracking-wider text-amber-400">Payments updated</p>
        <h1 className="mt-2 text-2xl font-semibold">Use the student&apos;s LumeX Wallet account</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Sponsor top-up checkout is retired. Students now receive deposits through their Paystack-backed LumeX Wallet account.
        </p>
        <Link href="/profile/virtual-account" className="lx-btn-amber mt-5 inline-flex px-5 py-3 text-sm">
          Open LumeX Wallet
        </Link>
      </section>
    </main>
  )
}
