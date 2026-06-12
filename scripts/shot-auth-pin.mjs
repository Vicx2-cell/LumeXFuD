// One-off: capture the /auth PIN step (the iPhone-unlock dots) in a few states.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:3000'
await mkdir('screenshots/after', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const page = await ctx.newPage()

await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' })
await page.fill('#lx-phone', '+2348012345678')
await page.getByRole('button', { name: /continue/i }).click()
await page.waitForTimeout(500)

// Type 3 of 6 digits to show partial fill + active caret cell.
await page.keyboard.type('123', { delay: 90 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'screenshots/after/auth-pin-partial.png', fullPage: true })

await browser.close()
console.log('done -> screenshots/after/auth-pin-partial.png')
