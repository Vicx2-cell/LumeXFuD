import Link from 'next/link'
import { Magnetic } from '@/components/fx'
import { HeroMotion } from './HeroMotion'
import { HeroTitle } from './HeroTitle'

/**
 * Cinematic homepage hero: a full-bleed food photo with a directional scrim,
 * slow Ken Burns + parallax (HeroMotion), film grain, an amber bloom over the
 * dish, and a choreographed entrance.
 */
export function Hero({ hoursLabel }: { hoursLabel: string }) {
  return (
    <section className="lx-hero" aria-label="LumeX Fud - premium food delivery and local discovery">
      <div className="lx-hero-media" data-cursor aria-hidden="true">
        <div className="lx-hero-fallback" />
        <HeroMotion />
        <div className="lx-hero-bloom" />
        <div className="lx-hero-scrim" />
        <div className="lx-hero-grain" />
      </div>

      <div className="lx-hero-inner lx-hero-choreo">
        <span className="lx-hero-kicker">
          <span className="lx-hero-kicker-dot" aria-hidden="true" />
          Starting with ABSU, built to scale city by city
        </span>

        <HeroTitle />

        <p className="lx-hero-sub">
          Order from trusted local vendors in minutes. Track every delivery live,
          from the kitchen to your doorstep as LumeX expands across campuses, cities, and states.
        </p>

        <div className="lx-hero-cta">
          <Magnetic className="w-full sm:w-auto">
            <Link
              href="/auth/register"
              className="lx-btn-amber flex w-full items-center justify-center px-8 py-4 text-base sm:w-auto"
              style={{ minHeight: 56 }}
            >
              Start ordering
            </Link>
          </Magnetic>
          <Magnetic className="w-full sm:w-auto">
            <Link
              href="/auth"
              className="lx-hero-ghost flex w-full items-center justify-center px-8 py-4 text-base font-medium sm:w-auto"
              style={{ minHeight: 56, borderRadius: 14 }}
            >
              I already have an account
            </Link>
          </Magnetic>
        </div>

        <p className="lx-hero-fine">Platform hours: {hoursLabel} daily</p>
      </div>

      <a href="#how-it-works" className="lx-scrollcue" aria-label="Scroll to learn how it works">
        <span className="lx-scrollcue-track" aria-hidden="true">
          <span className="lx-scrollcue-dot" />
        </span>
      </a>
    </section>
  )
}
