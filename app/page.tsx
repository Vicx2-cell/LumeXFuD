import Link from 'next/link'

export const metadata = {
  title: 'LumeX Fud — Campus life, simplified.',
  description: 'Order food from your favourite ABSU campus restaurants. Fast delivery to your hostel, live tracking, and rewards every time you order.',
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#0A0A0B', color: '#fff' }}>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-white/8"
        style={{ background: 'rgba(10,10,11,0.85)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <span className="font-bold text-lg tracking-tight">
            <span style={{ color: '#F5A623' }}>LumeX</span> Fud
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/auth"
              className="px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors"
            >
              Login
            </Link>
            <Link
              href="/auth/register"
              className="px-4 py-2 rounded-xl text-sm font-semibold text-black transition-opacity hover:opacity-90"
              style={{ background: '#F5A623' }}
            >
              Create account
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-5 py-20">
        <div className="max-w-2xl mx-auto space-y-6">
          <div
            className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-2"
            style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.3)' }}
          >
            Now live on ABSU campus
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight">
            Hot food, right to<br />
            <span style={{ color: '#F5A623' }}>your hostel door.</span>
          </h1>

          <p className="text-base sm:text-lg text-white/60 max-w-lg mx-auto leading-relaxed">
            Order from your favourite campus restaurants in minutes.
            Track your delivery live. Earn rewards every time you eat.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link
              href="/auth/register"
              className="px-8 py-4 rounded-2xl text-base font-semibold text-black transition-opacity hover:opacity-90"
              style={{ background: '#F5A623', minHeight: 56 }}
            >
              Start ordering
            </Link>
            <Link
              href="/auth"
              className="px-8 py-4 rounded-2xl text-base font-medium text-white transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.15)', minHeight: 56 }}
            >
              I already have an account
            </Link>
          </div>

          <p className="text-xs text-white/30 pt-1">
            Platform hours: 7am – 10pm daily
          </p>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section className="border-y border-white/8 py-8">
        <div className="max-w-4xl mx-auto px-5 grid grid-cols-3 gap-6 text-center">
          {[
            { value: '< 25 min', label: 'Average delivery' },
            { value: '100%',     label: 'Campus coverage' },
            { value: '7 days',   label: 'Every week' },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-2xl sm:text-3xl font-bold" style={{ color: '#F5A623' }}>{value}</p>
              <p className="text-xs sm:text-sm text-white/50 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-16 px-5">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Browse',
                desc: 'Open the app, see which campus restaurants are open right now, and pick what you want.',
              },
              {
                step: '02',
                title: 'Order',
                desc: 'Add items to your cart, choose delivery to your hostel or pick up, and pay securely.',
              },
              {
                step: '03',
                title: 'Delivered',
                desc: 'A rider picks up your order and brings it straight to you. Track every step live.',
              },
            ].map(({ step, title, desc }) => (
              <div
                key={step}
                className="rounded-3xl p-6 space-y-3"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-xs font-bold tracking-widest" style={{ color: '#F5A623' }}>{step}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-sm text-white/55 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why LumeX ── */}
      <section className="py-16 px-5 border-t border-white/8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            Built for campus life
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              {
                icon: '⚡',
                title: 'Fast delivery',
                desc: 'Our riders know every corner of ABSU campus. Average delivery under 25 minutes.',
              },
              {
                icon: '🏆',
                title: 'Earn rewards',
                desc: 'Every order earns you XP, streaks, and badges. Climb the weekly leaderboard.',
              },
              {
                icon: '📍',
                title: 'Live tracking',
                desc: 'See your order status in real time — from the kitchen to your doorstep.',
              },
              {
                icon: '🔒',
                title: 'Safe payments',
                desc: 'Pay with your card or bank transfer via Paystack. No cash, no stress.',
              },
            ].map(({ icon, title, desc }) => (
              <div
                key={title}
                className="rounded-3xl p-6 flex gap-4 items-start"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <span className="text-3xl flex-shrink-0">{icon}</span>
                <div>
                  <h3 className="font-semibold mb-1">{title}</h3>
                  <p className="text-sm text-white/55 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For vendors ── */}
      <section className="py-16 px-5 border-t border-white/8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-10 items-center">
          <div className="space-y-4">
            <div
              className="inline-block px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}
            >
              For vendors
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
              Grow your restaurant<br />on campus.
            </h2>
            <p className="text-sm text-white/55 leading-relaxed">
              Reach hundreds of hungry students every day. Manage your menu, track orders live,
              and get paid directly to your wallet every week.
            </p>
            <Link
              href="/auth"
              className="inline-block px-6 py-3 rounded-2xl text-sm font-semibold text-black transition-opacity hover:opacity-90"
              style={{ background: '#F5A623' }}
            >
              Apply as a vendor
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Weekly payouts', sub: 'Direct to your wallet' },
              { label: 'Live dashboard', sub: 'Orders in real time' },
              { label: 'Menu control', sub: 'Update anytime' },
              { label: 'Analytics', sub: 'Know your best sellers' },
            ].map(({ label, sub }) => (
              <div
                key={label}
                className="rounded-2xl p-4"
                style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.15)' }}
              >
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-white/40 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For riders ── */}
      <section className="py-16 px-5 border-t border-white/8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-10 items-center">
          <div className="grid grid-cols-1 gap-4 order-2 sm:order-1">
            {[
              { value: '₦400',  label: 'Per bike delivery' },
              { value: '₦800',  label: 'Per door delivery' },
              { value: 'Every', label: 'Friday — payout day' },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="rounded-2xl p-4 flex items-center gap-4"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-xl font-bold" style={{ color: '#F5A623' }}>{value}</span>
                <span className="text-sm text-white/60">{label}</span>
              </div>
            ))}
          </div>

          <div className="space-y-4 order-1 sm:order-2">
            <div
              className="inline-block px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}
            >
              For riders
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
              Earn on your<br />own schedule.
            </h2>
            <p className="text-sm text-white/55 leading-relaxed">
              Deliver on campus whenever you want. Accept orders, earn per delivery,
              and get paid every Friday — no delays, no excuses.
            </p>
            <Link
              href="/auth"
              className="inline-block px-6 py-3 rounded-2xl text-sm font-semibold text-black transition-opacity hover:opacity-90"
              style={{ background: '#F5A623' }}
            >
              Join as a rider
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 px-5 border-t border-white/8 text-center">
        <div className="max-w-xl mx-auto space-y-5">
          <h2 className="text-3xl font-bold">Ready to eat?</h2>
          <p className="text-white/55">
            Create your free account in under a minute and start ordering from campus restaurants now.
          </p>
          <Link
            href="/auth/register"
            className="inline-block px-10 py-4 rounded-2xl text-base font-semibold text-black transition-opacity hover:opacity-90"
            style={{ background: '#F5A623' }}
          >
            Get started — it's free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/8 py-8 px-5">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/30">
          <span>
            <span className="font-semibold" style={{ color: '#F5A623' }}>LumeX Fud</span>
            {' '}— Campus life, simplified.
          </span>
          <div className="flex items-center gap-5">
            <Link href="/terms"   className="hover:text-white/60 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy</Link>
          </div>
          <span>Platform hours: 7am – 10pm</span>
        </div>
      </footer>

    </div>
  )
}
