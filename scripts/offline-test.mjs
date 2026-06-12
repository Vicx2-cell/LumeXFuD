// PWA offline / airplane-mode test against the prod server (SW only registers in prod).
//   node scripts/offline-test.mjs    (BASE default http://localhost:3100)
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const outDir = 'screenshots/offline'
const results = []
const ok = (n, c, d = '') => { results.push({ n, c: !!c }); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`) }

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true })
  const page = await context.newPage()

  // 1. First online visit — SW installs + precaches; navigation gets cached.
  await page.goto('/', { waitUntil: 'networkidle' })
  // Wait for the SW to take control.
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 }).catch(() => {})
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    return { has: !!r, active: !!(r && r.active) }
  })
  ok('service worker registered + active', reg.has && reg.active, JSON.stringify(reg))

  // Reload so the SW controls the page and caches '/'.
  await page.reload({ waitUntil: 'networkidle' })
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
  ok('page controlled by SW after reload', controlled)

  // 2. Go offline (airplane mode).
  await context.setOffline(true)
  ok('navigator.onLine is false offline', !(await page.evaluate(() => navigator.onLine)))

  // 3. Cached homepage still loads offline.
  let homeOk = false
  try { const resp = await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10000 }); homeOk = !!resp } catch {}
  const homeText = await page.locator('body').innerText().catch(() => '')
  ok('cached homepage loads offline', homeOk && homeText.length > 0, `len=${homeText.length}`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(outDir, '1-home-offline.png'), fullPage: true }).catch(() => {})

  // 4. Offline banner visible.
  const banner = /offline/i.test(homeText)
  ok('offline banner shown ("You\'re offline")', banner, banner ? 'banner present' : 'no banner text')

  // 5. Uncached route falls back to /offline page.
  let fallback = ''
  try { await page.goto('/privacy?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 10000 }) } catch {}
  fallback = await page.locator('body').innerText().catch(() => '')
  ok('uncached route serves offline fallback', /offline|connection|no internet/i.test(fallback), fallback.replace(/\s+/g, ' ').slice(0, 80))
  await page.screenshot({ path: join(outDir, '2-offline-fallback.png'), fullPage: true }).catch(() => {})

  // 6. Back online.
  await context.setOffline(false)
  ok('recovers online', await page.evaluate(() => navigator.onLine))

  await browser.close()
  const passed = results.filter((r) => r.c).length
  console.log(`\n=== OFFLINE: ${passed}/${results.length} passed ===`)
  process.exit(passed === results.length ? 0 : 2)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
