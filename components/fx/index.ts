// Shared "premium feel" motion primitives. Build once, apply per surface tier
// (see LUMEX_PREMIUM_FEEL_BUILD_LOOP.md §3). All respect prefers-reduced-motion
// and pointer:coarse. Reveal lives at components/reveal.tsx and is re-exported
// here so callers can import everything from one place.
export { Reveal } from '../reveal'
export { CountUp } from './count-up'
export { CursorProvider } from './cursor-provider'
export { Magnetic } from './magnetic'
export { GlowField } from './glow-field'
export { AnimatedHeading, type HeadingSegment } from './animated-heading'
export { MarketingFx } from './marketing-fx'
export { SmoothScroll } from './smooth-scroll'
export { KineticHeading } from './kinetic-heading'
export { ClipReveal } from './clip-reveal'
export { Marquee } from './marquee'
