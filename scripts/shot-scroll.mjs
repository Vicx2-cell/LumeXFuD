// Capture a page after scrolling through it so scroll-reveal animations have fired.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const route = process.argv[2] ?? '/'
const name = process.argv[3] ?? 'home-scrolled'
const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:3000'
await mkdir('screenshots/after', { recursive: true })

const b = await chromium.launch()
const p = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }).then(c => c.newPage())
await p.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })

// Smoothly scroll to bottom in steps so IntersectionObserver fires for each section.
await p.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const h = document.body.scrollHeight
  for (let y = 0; y <= h; y += 300) { window.scrollTo(0, y); await sleep(80) }
  await sleep(400)
  window.scrollTo(0, 0)
  await sleep(600)
})
await p.screenshot({ path: `screenshots/after/${name}.png`, fullPage: true })
await b.close()
console.log(`done -> screenshots/after/${name}.png`)
