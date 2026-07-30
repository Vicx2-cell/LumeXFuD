type CallbackSearchParams = {
  order?: string
  intent?: string
}

export default async function PaystackCallbackPage({
  searchParams,
}: {
  searchParams?: Promise<CallbackSearchParams>
}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as CallbackSearchParams

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 animate-spin">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
          <path
            fill="currentColor"
            d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 1 0-8 8v2A10 10 0 0 1 12 2z"
          />
        </svg>
      </div>
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-700">Processing payment</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Your checkout is being verified</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        Paystack has returned to LumeX Fud. The server is verifying the transaction and updating your order
        state. This page does not mark anything paid.
      </p>
      {params.order ? (
        <p className="mt-6 text-xs uppercase tracking-[0.24em] text-slate-500">
          Order {params.order}
        </p>
      ) : null}
      {params.intent ? (
        <p className="mt-2 text-xs tracking-[0.2em] text-slate-400">
          Intent {params.intent}
        </p>
      ) : null}
    </main>
  )
}
