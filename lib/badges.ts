// Server-side mirror of the badge catalog seeded in migration 037. Kept here so
// the "Lumi explains this badge" endpoint is grounded (and works even before the
// DB migration runs). If you add a badge in 037, add it here too.

export interface BadgeMeaning {
  emoji: string
  name: string
  /** The factual unlock condition (what the chip's tooltip shows). */
  description: string
  /** A plain hint of HOW to earn it — context for Lumi's explanation. */
  howto: string
}

export const BADGE_MEANINGS: Record<string, BadgeMeaning> = {
  'first-bite':      { emoji: '🍴', name: 'First Bite',      description: 'Placed your first order',           howto: 'awarded the moment your first order is delivered' },
  'consistent':      { emoji: '🔥', name: 'Consistent',      description: '3-day order streak',                howto: 'order on 3 days in a row' },
  'weekly-warrior':  { emoji: '🗓️', name: 'Weekly Warrior',  description: '7-day order streak',                howto: 'keep a streak alive for 7 days straight' },
  'two-week-legend': { emoji: '⚡', name: 'Two-Week Legend', description: '14-day order streak',               howto: 'order every day for two full weeks' },
  'monthly-master':  { emoji: '👑', name: 'Monthly Master',  description: '30-day order streak',               howto: 'order every single day for a whole month' },
  'regular':         { emoji: '🍲', name: 'Regular',         description: 'Completed 10 orders',               howto: 'have 10 orders delivered in total' },
  'foodie':          { emoji: '🌍', name: 'Foodie',          description: 'Ordered from 10 different vendors', howto: 'try 10 different vendors on campus' },
  'loyal':           { emoji: '💎', name: 'Loyal Customer',  description: 'Completed 100 orders',              howto: 'reach 100 delivered orders' },
  'big-spender':     { emoji: '💸', name: 'Big Spender',     description: 'A single order over ₦5,000',        howto: 'place one order worth more than ₦5,000' },
  'night-owl':       { emoji: '🌙', name: 'Night Owl',       description: 'Ordered between 9pm and 6am',       howto: 'get an order delivered late at night (9pm–6am)' },
  'early-bird':      { emoji: '🌅', name: 'Early Bird',      description: 'Ordered before 9am',                howto: 'get an order delivered early in the morning (before 9am)' },
}
