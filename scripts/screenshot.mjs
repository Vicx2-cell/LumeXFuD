// Reusable Playwright screenshot harness for UI before/after comparisons.
//
// Usage:
//   node scripts/screenshot.mjs <label> <route> [route...]
//
//   <label>   "before" | "after" (any folder name) — output goes to screenshots/<label>/
//   <route>   path(s) to capture, e.g. /auth / "/vendor/123" /cart
//
// Env:
//   SHOT_BASE_URL   base origin (default http://localhost:3000)
//   SHOT_PHONE      E.164 phone for PIN login (optional — needed for auth-gated pages)
//   SHOT_PIN        6-digit PIN matching SHOT_PHONE (optional)
//   SHOT_WIDTH      viewport width  (default 375 — the design baseline)
//   SHOT_HEIGHT     viewport height (default 812)
//   SHOT_MOTION     "reduce" to emulate prefers-reduced-motion (default no preference)
//
// Examples:
//   node scripts/screenshot.mjs before /auth / /cart
//   SHOT_PHONE=+2348012345678 SHOT_PIN=123456 node scripts/screenshot.mjs after /profile /rider

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const [label, ...routes] = process.argv.slice(2)

if (!label || routes.length === 0) {
  console.error('Usage: node scripts/screenshot.mjs <label> <route> [route...]')
  process.exit(1)
}

const BASE   = process.env.SHOT_BASE_URL ?? 'http://localhost:3000'
const WIDTH  = Number(process.env.SHOT_WIDTH ?? 375)
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 812)
const PHONE  = process.env.SHOT_PHONE
const PIN    = process.env.SHOT_PIN
const MOTION = process.env.SHOT_MOTION === 'reduce' ? 'reduce' : 'no-preference'

const outDir = join('screenshots', label)
const slug = (r) => (r === '/' ? 'home' : r.replace(/^\//, '').replace(/[\/\[\]:?=&]/g, '_'))

async function login(page) {
  if (!PHONE || !PIN) return false
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' })
  await page.fill('input[type="tel"]', PHONE)
  // "Login" / continue button advances to the PIN step
  await page.getByRole('button', { name: /login|continue/i }).first().click()
  await page.waitForTimeout(400)
  // Type the PIN — covers both a single hidden input and per-digit inputs.
  await page.keyboard.type(PIN, { delay: 60 })
  // Auth page auto-submits on the 6th digit; wait for navigation away from /auth.
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 8000 }).catch(() => {})
  const ok = !page.url().includes('/auth')
  console.log(ok ? `  ✓ logged in as ${PHONE}` : `  ⚠ login did not navigate away from /auth`)
  return ok
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: MOTION,
  })
  const page = await context.newPage()

  if (PHONE && PIN) {
    console.log('Authenticating…')
    await login(page)
  }

  for (const route of routes) {
    const url = `${BASE}${route}`
    const file = join(outDir, `${slug(route)}.png`)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      // Let spring/enter animations settle before capturing.
      await page.waitForTimeout(1200)
      await page.screenshot({ path: file, fullPage: true })
      console.log(`  ✓ ${route} → ${file}  (landed on ${new URL(page.url()).pathname})`)
    } catch (err) {
      console.log(`  ✗ ${route} — ${err.message}`)
    }
  }

  await browser.close()
  console.log(`\nDone. Screenshots in ${outDir}/`)
}

main().catch((e) => { console.error(e); process.exit(1) })
