import Link from 'next/link'
import { Magnetic } from '@/components/fx'
import { HeroMotion } from './HeroMotion'
import { HeroTitle } from './HeroTitle'

/**
 * Cinematic homepage hero: a full-bleed food photo with a directional scrim,
 * slow Ken Burns + parallax (HeroMotion), film grain, an amber bloom over the
 * dish, and a choreographed entrance. Server component for the markup/copy; the
 * single `'use client'` island is <HeroMotion> for the image motion. Motion FX
 * reuse the shared primitives (AnimatedHeading, Magnetic, CursorProvider mounted
 * by the page's <MarketingFx>).
 *
 * Boldness is spent here and nowhere else — the rest of the page stays quiet.
 */
export function Hero({ hoursLabel }: { hoursLabel: string }) {
  return (
    <section className="lx-hero" aria-label="LumeX Fud — campus food delivery">
      {/* ── Media stack (back → front) ── */}
      <div className="lx-hero-media" data-cursor aria-hidden="true">
        {/* Gradient fallback so it's never blank before/behind the photo */}
        <div className="lx-hero-fallback" />
        {/* The photo: Ken Burns + scroll parallax */}
        <HeroMotion />
        {/* Amber bloom tying the dish to the brand colour (slow pulse) */}
        <div className="lx-hero-bloom" />
        {/* Readability scrim: dark-left → clear-right, plus a bottom lift */}
        <div className="lx-hero-scrim" />
        {/* Film grain — kills the flat digital look */}
        <div className="lx-hero-grain" />
      </div>

      {/* ── Content ── */}
      <div className="lx-hero-inner lx-hero-choreo">
        <span className="lx-hero-kicker">
          <span className="lx-hero-kicker-dot" aria-hidden="true" />
          Now live on ABSU campus
        </span>

        <HeroTitle />

        <p className="lx-hero-sub">
          Order from your favourite campus restaurants in minutes. Track your
          delivery live, every step from the kitchen to your hostel door.
        </p>

        <div className="lx-hero-cta">
          <Magnetic className="w-full sm:w-auto">
            <Link
              href="/auth/register"
              className="lx-btn-amber px-8 py-4 text-base flex items-center justify-center w-full sm:w-auto"
              style={{ minHeight: 56 }}
            >
              Start ordering
            </Link>
          </Magnetic>
          <Magnetic className="w-full sm:w-auto">
            <Link
              href="/auth"
              className="lx-hero-ghost px-8 py-4 text-base font-medium flex items-center justify-center w-full sm:w-auto"
              style={{ minHeight: 56, borderRadius: 14 }}
            >
              I already have an account
            </Link>
          </Magnetic>
        </div>

        <p className="lx-hero-fine">Platform hours: {hoursLabel} daily</p>
      </div>

      {/* ── Scroll cue ── */}
      <a href="#how-it-works" className="lx-scrollcue" aria-label="Scroll to learn how it works">
        <span className="lx-scrollcue-track" aria-hidden="true">
          <span className="lx-scrollcue-dot" />
        </span>
      </a>
    </section>
  )
}
