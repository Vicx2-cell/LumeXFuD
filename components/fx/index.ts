// Shared "premium feel" motion primitives. Build once, apply per surface tier
// (see LUMEX_PREMIUM_FEEL_BUILD_LOOP.md §3). All respect prefers-reduced-motion
// and pointer:coarse. Reveal lives at components/reveal.tsx and is re-exported
// here so callers can import everything from one place.
export { CountUp } from './count-up'
export { Magnetic } from './magnetic'
export { GlowField } from './glow-field'
export { MarketingFx } from './marketing-fx'
export { SmoothScroll } from './smooth-scroll'
export { KineticHeading } from './kinetic-heading'
export { ClipReveal } from './clip-reveal'
export { Marquee } from './marquee'
export { ParallaxImage } from './parallax-image'
export { ImageMarquee } from './image-marquee'
export { GlassSheen } from './glass-sheen'
export { PremiumImage } from './premium-image'
