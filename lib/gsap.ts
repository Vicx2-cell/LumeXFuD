// Central GSAP setup for the marketing/premium surfaces (landing + customer
// home). Imported only from 'use client' components, so plugin registration
// runs in the browser. We register ScrollTrigger (scroll-driven motion) and
// CustomEase (bespoke curves — bespoke motion is what stops the site looking
// templated), and define the brand easing once so every animation feels of a
// piece with the CSS spring curves already used across the app.
//
// All consumers must still self-guard prefers-reduced-motion: this module only
// wires the engine up; it does not decide whether motion should play.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, CustomEase)

  // Mirror the CSS easing tokens (globals.css --spring-*) so GSAP-driven and
  // CSS-driven motion share a vocabulary. Re-creating a CustomEase by the same
  // name just overwrites it, so this is safe across Fast-Refresh re-imports.
  CustomEase.create('lx-smooth', '0.33, 1, 0.68, 1')   // page/section reveals
  CustomEase.create('lx-snappy', '0.22, 1, 0.36, 1')   // buttons, snaps
  CustomEase.create('lx-rise', '0.16, 1, 0.3, 1')      // kinetic type lift
}

export { gsap, ScrollTrigger, CustomEase }

/** True when the OS asks us to minimise motion. Safe to call on the client. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
