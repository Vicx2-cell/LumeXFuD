import Link from 'next/link'
import type { ReactNode } from 'react'
import { getFeature } from '@/lib/features'
import { formatPrice } from '@/lib/money'
import { formatHoursRange } from '@/lib/hours'
import { vendorPath } from '@/lib/seo/config'
import { guidePath, type FaqItem } from '@/lib/seo/guides'
import { getOpenLateVendors, getBudgetSnapshot } from '@/lib/seo/guides-data'

export interface BuiltGuide {
  faq: FaqItem[]
  lead: ReactNode
  related: { href: string; label: string }[]
}

// Build a guide's body + FAQ at request time so everything can be gated to what
// is actually true (the `ordering` flag, live hours, real prices). Returns null
// for an unknown slug. The page emits FAQPage JSON-LD from the returned `faq`.
export async function buildGuide(slug: string): Promise<BuiltGuide | null> {
  switch (slug) {
    case 'how-to-spot-food-vendor-scams-uturu': return scamsGuide()
    case 'whats-open-late-near-absu':           return openLateGuide()
    case 'how-escrow-protects-you-on-lumexfud': return escrowGuide()
    case 'eating-well-on-a-budget-near-absu':   return budgetGuide()
    default: return null
  }
}

// Small shared bits ----------------------------------------------------------
function P({ children }: { children: ReactNode }) {
  return <p className="text-white/75 leading-relaxed mb-4">{children}</p>
}
function H2({ children }: { children: ReactNode }) {
  return <h2 className="lx-display text-xl font-bold mt-8 mb-3">{children}</h2>
}
function Checklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2.5 mb-4">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 items-start">
          <span className="lx-amber mt-1 shrink-0" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <span className="text-white/75 text-sm leading-relaxed">{it}</span>
        </li>
      ))}
    </ul>
  )
}

// How escrow is described EVERYWHERE — gated to whether ordering is actually live.
function escrowSentence(orderingLive: boolean): string {
  return orderingLive
    ? "On LumeX you don't pay the vendor directly — you pay LumeX, and the money is held until your order is delivered. If something goes wrong, you have a protection window after delivery to report it and get a refund."
    : "Ordering on LumeX is paused right now. When it's live, you don't pay the vendor directly — you pay LumeX, which holds the money until your order is delivered, with a protection window after delivery to report problems and get a refund."
}

// 1) Scams ------------------------------------------------------------------
async function scamsGuide(): Promise<BuiltGuide> {
  const orderingLive = await getFeature('ordering')
  const lead = (
    <>
      <P>
        Most food in Uturu still gets sold over WhatsApp statuses, DMs and word of mouth. That works
        most of the time — but it&apos;s also where students get burned: you send money to a personal
        account, and the food never comes, the price changes, or the person goes quiet. There&apos;s no
        one to call and no way to get your money back.
      </P>
      <P>Here&apos;s how to order food around ABSU without getting scammed.</P>

      <H2>Red flags to watch for</H2>
      <Checklist items={[
        <>You&apos;re asked to <strong>transfer to a personal bank account</strong> before you&apos;ve seen a real menu or price.</>,
        <>The price is hidden — &ldquo;DM for price&rdquo; — or it goes up after you&apos;ve already paid.</>,
        <>No delivery fee is mentioned, then it&apos;s sprung on you at the door.</>,
        <>The seller can&apos;t show you anything that proves who they are or where the kitchen is.</>,
        <>You&apos;re pressured to &ldquo;pay now or lose it&rdquo; with no way to confirm the order.</>,
      ]} />

      <H2>How to stay safe</H2>
      <Checklist items={[
        <><strong>Never pay a stranger&apos;s personal account.</strong> A personal transfer has zero protection — once it&apos;s gone, it&apos;s gone.</>,
        <><strong>Order through a platform that verifies its vendors</strong> and shows the full menu with the all-in price (food + delivery) before you pay.</>,
        <><strong>Pay the platform, not the vendor.</strong> That way the money is held until the food actually reaches you.</>,
        <><strong>Keep your order number / receipt.</strong> It&apos;s your proof if you need to report a problem.</>,
        <><strong>Confirm the vendor is verified</strong> before a first order with someone new.</>,
      ]} />

      <H2>Where LumeX fits in</H2>
      <P>{escrowSentence(orderingLive)}</P>
      <P>
        LumeX vendors complete identity verification, and every menu shows the honest all-in price up
        front. You can see a vendor&apos;s real menu, hours and reviews on its page before you ever
        spend a naira — for example,{' '}
        <Link href={vendorPath('chines-kitchen')} className="lx-amber hover:underline">Chines Kitchen</Link>.
      </P>
    </>
  )
  const faq: FaqItem[] = [
    {
      question: 'How do I know a food vendor near ABSU is legit?',
      answer: 'Order through a service that verifies its vendors and holds your payment until delivery, instead of sending money to a personal account from a WhatsApp status or DM. Look for a real menu, a clear all-in price, and identity verification before you pay someone new.',
    },
    {
      question: "Is it safe to transfer money to a vendor's personal bank account?",
      answer: 'No. A personal-account transfer has no protection — if the food never comes or the order is wrong, you have no way to recover the money. Pay a platform that holds the funds until your food arrives.',
    },
    {
      question: "What if I'm asked to pay before I can see the menu or price?",
      answer: 'Treat hidden or "DM for price" pricing as a red flag. Use a service that shows the full menu and the all-in price, including delivery, before you commit.',
    },
    {
      question: 'What should I do if my order never arrives?',
      answer: escrowSentence(await getFeature('ordering')) + ' Always keep your order number so you can report a problem.',
    },
  ]
  return {
    faq, lead,
    related: [
      { href: guidePath('how-escrow-protects-you-on-lumexfud'), label: 'How escrow protects you' },
      { href: guidePath('whats-open-late-near-absu'), label: "What's open late near ABSU" },
    ],
  }
}

// 2) What's open late --------------------------------------------------------
async function openLateGuide(): Promise<BuiltGuide> {
  const { vendors, platformClose } = await getOpenLateVendors()
  const hoursLabel = formatHoursRange('07:00', platformClose)
  const hasLate = vendors.length > 0

  const lead = (
    <>
      <P>
        Late-night cravings around ABSU are real — but Uturu isn&apos;t a 24-hour town, and most
        campus kitchens wind down in the evening. Here&apos;s how to find food when it&apos;s late, and
        what&apos;s actually open.
      </P>

      <H2>The platform runs until {fmtTime(platformClose)}</H2>
      <P>
        On LumeX, ordering is open daily from {hoursLabel}. The single most reliable move for a late
        meal is simple: <strong>order before the kitchens close</strong> rather than after. A vendor&apos;s
        live status (Open / Busy / Closed) on its page is the source of truth at any moment.
      </P>

      <H2>Vendors that stay open late</H2>
      {hasLate ? (
        <>
          <P>These campus vendors currently publish closing times of 9pm or later:</P>
          <ul className="space-y-2 mb-4">
            {vendors.map((v) => (
              <li key={v.slug} className="glass-thin rounded-xl p-3 flex items-center justify-between gap-3">
                <Link href={vendorPath(v.slug)} className="font-medium text-sm lx-amber hover:underline">{v.shopName}</Link>
                <span className="text-xs text-white/55">open until {fmtTime(v.closingTime)}</span>
              </li>
            ))}
          </ul>
          <P>Always check the vendor&apos;s live status before ordering — published hours are a guide, not a guarantee.</P>
        </>
      ) : (
        <>
          <P>
            <strong>Being honest:</strong> no campus vendor has published late opening hours yet, so we
            won&apos;t pretend there&apos;s a late-night list when there isn&apos;t. As more vendors join
            and set their hours, the ones that stay open late will appear here automatically.
          </P>
          <P>Until then:</P>
          <Checklist items={[
            <>Check the app in the evening for any vendor still showing <strong>Open</strong> — that&apos;s live and accurate.</>,
            <>Order earlier rather than later; kitchens get busier and start closing as the night goes on.</>,
            <>If you know you&apos;ll be up late, plan the order before {fmtTime(platformClose)}.</>,
          ]} />
        </>
      )}
    </>
  )

  const faq: FaqItem[] = [
    {
      question: 'How late can I order food near ABSU?',
      answer: `On LumeX, ordering is open daily from ${hoursLabel}. Individual vendors set their own closing times within that window, and a vendor's live Open/Busy/Closed status is the real source of truth at any moment.`,
    },
    {
      question: 'How do I know if a vendor is actually open right now?',
      answer: "Check the vendor's page or the app — each vendor shows a live Open, Busy or Closed status. Published opening hours are a guide; the live status is what's accurate at that moment.",
    },
    {
      question: 'What if nothing is open late?',
      answer: 'Order before the kitchens close rather than after. If you expect a late night, place the order earlier in the evening while vendors are still open.',
    },
  ]

  return {
    faq, lead,
    related: [
      { href: guidePath('eating-well-on-a-budget-near-absu'), label: 'Eating well on a budget' },
      { href: guidePath('how-to-spot-food-vendor-scams-uturu'), label: 'Spotting food-vendor scams' },
    ],
  }
}

// 3) Escrow explainer --------------------------------------------------------
async function escrowGuide(): Promise<BuiltGuide> {
  const orderingLive = await getFeature('ordering')
  const lead = (
    <>
      <P>
        The biggest worry when you order food online is simple: <em>what if I pay and the food
        never comes?</em> That&apos;s exactly what escrow is built to solve. Here&apos;s how your money
        is protected on LumeX, in plain language.
      </P>

      <H2>You pay LumeX, not the vendor</H2>
      <P>{escrowSentence(orderingLive)}</P>

      <H2>How the money moves</H2>
      <Checklist items={[
        <>You pay securely with your card, bank transfer or USSD through Paystack.</>,
        <>LumeX <strong>holds</strong> that money — the vendor and rider do not get it upfront.</>,
        <>Your food is prepared, picked up and delivered, with live status the whole way.</>,
        <>Only <strong>after delivery</strong> — and a protection window for you to flag any problem — is the money released to the vendor and rider.</>,
        <>If something genuinely went wrong, the held funds mean a refund is actually possible.</>,
      ]} />

      <H2>Why this matters near ABSU</H2>
      <P>
        Paying a stranger&apos;s personal account gives you no recourse. Escrow flips that: the platform
        stands in the middle, so an honest vendor still gets paid and you&apos;re not exposed if a deal
        goes bad. It&apos;s the core difference between ordering on LumeX and DM-ing a vendor —
        see also <Link href={guidePath('how-to-spot-food-vendor-scams-uturu')} className="lx-amber hover:underline">how to spot food-vendor scams</Link>.
      </P>
    </>
  )
  const faq: FaqItem[] = [
    {
      question: 'Who holds my money when I order on LumeX?',
      answer: escrowSentence(orderingLive),
    },
    {
      question: 'When does the vendor actually get paid?',
      answer: 'The vendor and rider are paid only after your order is delivered and a short protection window has passed. They do not receive your money upfront.',
    },
    {
      question: "What happens if my food doesn't arrive or the order is wrong?",
      answer: 'Because the money is held rather than sent straight to the vendor, a refund is possible. Report the problem within the protection window after delivery and keep your order number.',
    },
    {
      question: 'How do I pay?',
      answer: 'Securely through Paystack — card, bank transfer or USSD. LumeX never asks you to transfer to a personal account.',
    },
  ]
  return {
    faq, lead,
    related: [
      { href: guidePath('how-to-spot-food-vendor-scams-uturu'), label: 'Spotting food-vendor scams' },
      { href: guidePath('eating-well-on-a-budget-near-absu'), label: 'Eating well on a budget' },
    ],
  }
}

// 4) Eating well on a budget -------------------------------------------------
async function budgetGuide(): Promise<BuiltGuide> {
  const { fees, prices } = await getBudgetSnapshot()
  const lead = (
    <>
      <P>
        Stretching a small daily food budget is one of the hardest parts of campus life — and it&apos;s
        worse with prices climbing. This isn&apos;t about eating less; it&apos;s about getting more good
        food for the naira you have. Here&apos;s how to keep the cost per meal down around ABSU.
      </P>

      <H2>Know the all-in price before you pay</H2>
      <P>
        The number that matters isn&apos;t the food price — it&apos;s the <strong>all-in</strong>: food
        + the platform fee ({formatPrice(fees.platformMarkupKobo)}) + delivery. Bike delivery
        ({formatPrice(fees.bikeFeeKobo)}) is cheaper than door-to-room ({formatPrice(fees.doorFeeKobo)}),
        so choosing bike and meeting the rider downstairs is an easy saving on every order.
        {prices ? (
          <> Right now, meals on LumeX start from around <strong>{formatPrice(prices.minAllInKobo)} all-in</strong> for the cheapest item with bike delivery.</>
        ) : null}
      </P>

      <H2>Practical ways to spend less</H2>
      <Checklist items={[
        <><strong>Split the delivery fee.</strong> Delivery is per order, not per person — ordering together with friends from the same vendor splits that cost several ways.</>,
        <><strong>Order in one go.</strong> Two small separate orders pay delivery twice. Combine them and you pay it once.</>,
        <><strong>Pick bike over door delivery</strong> when you can meet the rider — that&apos;s {formatPrice(fees.doorFeeKobo - fees.bikeFeeKobo)} saved each time.</>,
        <><strong>Clear the minimum order ({formatPrice(fees.minOrderKobo)}) with food you&apos;ll actually eat</strong>, not filler — add a protein or a drink you wanted anyway rather than wasting it.</>,
        <><strong>Compare vendors.</strong> Each vendor page shows its price range, so you can find the ones that fit your budget before ordering.</>,
      ]} />

      <H2>Eat enough, not just cheap</H2>
      <P>
        Budgeting shouldn&apos;t mean skipping meals. A filling plate of rice with a protein usually
        costs less per serving than several small snacks through the day, and keeps you going longer.
        Spend where it fills you up. You can browse real menus and prices — for instance{' '}
        <Link href={vendorPath('chines-kitchen')} className="lx-amber hover:underline">Chines Kitchen</Link> —
        to see what fits.
      </P>
    </>
  )
  const faq: FaqItem[] = [
    {
      question: "What's the cheapest way to order food near ABSU?",
      answer: `Choose bike delivery over door-to-room (it's ${formatPrice(fees.bikeFeeKobo)} vs ${formatPrice(fees.doorFeeKobo)}), order everything in one go so you only pay delivery once, and split the delivery fee by ordering together with friends from the same vendor.`,
    },
    {
      question: 'How much is delivery, and can I split it?',
      answer: `Bike delivery is ${formatPrice(fees.bikeFeeKobo)} and door-to-room is ${formatPrice(fees.doorFeeKobo)} per order. Delivery is charged per order, not per person — so ordering with friends from the same vendor splits that one fee between you.`,
    },
    {
      question: 'Is there a minimum order?',
      answer: `Yes, the minimum order is ${formatPrice(fees.minOrderKobo)}. Reach it with food you actually want — a protein or a drink — rather than filler you won't eat.`,
    },
  ]
  return {
    faq, lead,
    related: [
      { href: guidePath('whats-open-late-near-absu'), label: "What's open late near ABSU" },
      { href: guidePath('how-escrow-protects-you-on-lumexfud'), label: 'How escrow protects you' },
    ],
  }
}

// Local time formatter (mirror of lib/seo/vendor-data fmt — small, no import).
function fmtTime(t: string): string {
  const [h, m] = (t ?? '').split(':')
  let hh = parseInt(h, 10)
  if (!Number.isFinite(hh)) return t
  const ampm = hh >= 12 ? 'pm' : 'am'
  hh = hh % 12 || 12
  const mm = m && m !== '00' ? `:${m}` : ''
  return `${hh}${mm}${ampm}`
}
