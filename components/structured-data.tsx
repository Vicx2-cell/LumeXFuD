// Site-wide schema.org structured data (JSON-LD), rendered once in the root
// layout. Modelled as a cross-linked @graph so Google understands LumeX Fud is
// a food-delivery business serving Abia State University (ABSU), Uturu.
//
// Truthfulness note: only facts we can stand behind are included (brand, area
// served, platform hours, public pages). We deliberately omit a precise street
// address / geo-coordinates, a telephone, and fabricated menu prices — LumeX is
// a multi-vendor marketplace, so inventing a single restaurant's menu items or
// location would risk a structured-data spam penalty. The Menu node points at
// the live vendor listing where the real, per-vendor menus are served.

const SITE_URL = 'https://lumexfud.com.ng'

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'LumeX Fud',
      legalName: 'LumeX',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/icons/icon-512-v2.png`,
        width: 512,
        height: 512,
      },
      image: `${SITE_URL}/icons/icon-512-v2.png`,
      slogan: 'Campus life, simplified.',
      description:
        'LumeX Fud is campus food delivery for Abia State University (ABSU), Uturu — order from campus restaurants and get it delivered to your hostel with live tracking and secure digital payment.',
      areaServed: {
        '@type': 'Place',
        name: 'Abia State University (ABSU), Uturu',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'LumeX Fud',
      description:
        'Campus food delivery for Abia State University (ABSU), Uturu.',
      inLanguage: 'en-NG',
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      // A food-delivery establishment representing the LumeX Fud brand. Restaurant
      // is a sub-type of FoodEstablishment/LocalBusiness, so this single node
      // carries the LocalBusiness + Restaurant + Menu signals Google looks for.
      '@type': 'Restaurant',
      '@id': `${SITE_URL}/#restaurant`,
      name: 'LumeX Fud',
      url: SITE_URL,
      image: `${SITE_URL}/icons/icon-512-v2.png`,
      description:
        'Campus food delivery serving Abia State University (ABSU), Uturu — fast hostel delivery, live order tracking, and secure digital payment.',
      parentOrganization: { '@id': `${SITE_URL}/#organization` },
      servesCuisine: ['Nigerian', 'African', 'Fast Food'],
      priceRange: '₦₦',
      currenciesAccepted: 'NGN',
      paymentAccepted: 'Card, Bank Transfer, USSD, Wallet',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Uturu',
        addressRegion: 'Abia',
        addressCountry: 'NG',
      },
      areaServed: {
        '@type': 'Place',
        name: 'Abia State University (ABSU), Uturu',
      },
      // Platform hours: 7am–10pm, every day (see CLAUDE.md pricing block).
      openingHoursSpecification: {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
          'Monday', 'Tuesday', 'Wednesday', 'Thursday',
          'Friday', 'Saturday', 'Sunday',
        ],
        opens: '07:00',
        closes: '22:00',
      },
      availableLanguage: 'en-NG',
      hasMenu: {
        '@type': 'Menu',
        '@id': `${SITE_URL}/#menu`,
        name: 'LumeX Fud — Campus restaurants',
        url: `${SITE_URL}/`,
        description:
          'Browse live menus from campus restaurants on LumeX Fud. Dishes, availability and prices are set per vendor and shown on each vendor’s page.',
        inLanguage: 'en-NG',
        hasMenuSection: [
          { '@type': 'MenuSection', name: 'Rice & Swallow' },
          { '@type': 'MenuSection', name: 'Proteins & Sides' },
          { '@type': 'MenuSection', name: 'Snacks & Small Chops' },
          { '@type': 'MenuSection', name: 'Drinks' },
        ],
      },
    },
  ],
}

export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; there is no user-controlled
      // data here, and we escape the closing-tag sequence defensively.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
      }}
    />
  )
}
