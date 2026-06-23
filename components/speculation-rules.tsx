// Speculation Rules — modern, progressive-enhancement instant navigation.
//
// On Chromium browsers (Chrome/Edge 121+, Samsung Internet — i.e. our PRIMARY
// budget-Android target) this tells the browser to PRERENDER a same-origin page
// in the background when the user shows intent (hover / pointer-down), so a real
// navigation to it is effectively instant. Safari/Firefox ignore the script
// entirely, so it can never break them — pure enhancement.
//
// Scope is deliberately conservative:
//   • eagerness "moderate" → only fires on hover / pointerdown (real intent),
//     not for every link in the viewport, so we don't waste data/CPU on a phone.
//   • Excludes /api/* (never a page), the auth/logout flows and anything tagged
//     data-no-prerender (so a side-effecting GET is never triggered early).
//
// It renders a plain inline <script type="speculationrules"> — no JS runs in our
// bundle; the browser reads the JSON natively.
const RULES = {
  prerender: [
    {
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/api/*' } },
          { not: { href_matches: '/auth/*' } },
          { not: { href_matches: '/logout' } },
          { not: { selector_matches: '[data-no-prerender]' } },
          { not: { selector_matches: '[rel~="external"]' } },
        ],
      },
      eagerness: 'moderate',
    },
  ],
}

export function SpeculationRules() {
  return (
    <script
      type="speculationrules"
      // The content is a static, trusted JSON literal (no user input), so this is
      // safe; it's the only supported way to register speculation rules inline.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(RULES) }}
    />
  )
}
