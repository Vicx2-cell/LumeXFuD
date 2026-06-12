// Live end-to-end flow test (customer leg) against a running prod server.
//   node scripts/live-flow.mjs
// Env: BASE (default http://localhost:3100)
//
// Covers what is automatable locally: register -> auto-login -> browse ->
// add to cart -> checkout -> reach Paystack hosted checkout.
// The post-payment chain (webhook -> vendor accept -> rider deliver -> wallet
// -> badge -> leaderboard) cannot run locally: Paystack's confirmation webhook
// can't reach localhost, and there are no vendor/rider credentials. That leg is
// a staging/prod test with the public webhook URL configured.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:3100'
const VENDOR_ID = '22aa5c78-c573-4cb6-bf98-bd07de4276b3' // Divine Bites (seeded)
const outDir = 'screenshots/live'

const rnd = Math.floor(100000000 + Math.random() * 899999999) // 9 digits
const PHONE = '+2348' + rnd                                   // valid NG mobile
const PIN = '528417'                                          // non-weak, non-sequential

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

async function shot(page, name) {
  try { await page.screenshot({ path: join(outDir, name + '.png'), fullPage: true }) } catch {}
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [browser error]', m.text().slice(0, 200)) })

  // ── 1. REGISTER (real API; cookie jar shared with the browser context) ──
  const reg = await context.request.post('/api/auth/register', {
    data: {
      name: 'Test Student', phone: PHONE, pin: PIN, confirm_pin: PIN,
      question_1: 'What is your favorite food?', answer_1: 'jollof rice',
      question_2: 'What city were you born in?', answer_2: 'umuahia',
    },
  })
  const regBody = await reg.json().catch(() => ({}))
  ok('register + auto-login', reg.ok() && regBody.success, `phone=${PHONE} status=${reg.status()} recovery=${regBody.recovery_code ? 'issued' : 'none'}`)

  // session cookie present in the shared jar?
  const cookies = await context.cookies()
  ok('session cookie set (httpOnly)', cookies.some((c) => c.name === 'session' && c.httpOnly), cookies.find((c) => c.name === 'session') ? 'httpOnly=' + cookies.find((c) => c.name === 'session').httpOnly : 'no session cookie')

  // ── 2. /api/auth/me reflects the logged-in customer ──
  const me = await context.request.get('/api/auth/me')
  const meBody = await me.json().catch(() => ({}))
  ok('authenticated as customer', me.ok() && (meBody.role === 'customer' || meBody.user?.role === 'customer'), `status=${me.status()} role=${meBody.role ?? meBody.user?.role}`)

  // ── 3. HOMEPAGE shows the seeded vendor ──
  await page.goto('/', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(800)
  const homeText = await page.locator('body').innerText()
  ok('homepage renders vendor list', /Divine Bites/i.test(homeText), 'Divine Bites visible: ' + /Divine Bites/i.test(homeText))
  await shot(page, '1-home')

  // ── 4. VENDOR page + add an item to cart ──
  await page.goto('/vendor/' + VENDOR_ID, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(800)
  await shot(page, '2-vendor')
  // Find an add-to-cart control: button containing Add / + / Add to cart
  let added = false
  const addCandidates = page.getByRole('button', { name: /add|\+/i })
  const n = await addCandidates.count()
  for (let i = 0; i < n && !added; i++) {
    try { await addCandidates.nth(i).click({ timeout: 1500 }); added = true } catch {}
  }
  if (!added) {
    // fallback: any clickable element with a plus glyph
    try { await page.locator('button:has-text("+")').first().click({ timeout: 1500 }); added = true } catch {}
  }
  await page.waitForTimeout(600)
  ok('added an item to cart (UI)', added, `add-buttons found=${n}`)
  await shot(page, '3-vendor-after-add')

  // ── 5. CART ──
  await page.goto('/cart', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(800)
  const cartText = await page.locator('body').innerText()
  const hasItems = !/empty/i.test(cartText) && /(pay|checkout|total)/i.test(cartText)
  ok('cart shows items + checkout', hasItems, 'cart text snippet: ' + cartText.replace(/\s+/g, ' ').slice(0, 120))
  await shot(page, '4-cart')

  // ── 6. CHECKOUT → expect redirect to Paystack hosted checkout ──
  let reachedPaystack = false, checkoutDetail = ''
  if (hasItems) {
    const payBtn = page.getByRole('button', { name: /pay|checkout|place order/i }).first()
    try {
      await Promise.all([
        page.waitForURL(/paystack\.com|checkout\.paystack/i, { timeout: 20000 }).then(() => { reachedPaystack = true }).catch(() => {}),
        payBtn.click({ timeout: 3000 }),
      ])
    } catch (e) { checkoutDetail = e.message.slice(0, 120) }
    await page.waitForTimeout(1500)
    if (!reachedPaystack) {
      const u = page.url()
      reachedPaystack = /paystack/i.test(u)
      checkoutDetail = checkoutDetail || ('landed: ' + u)
    } else {
      checkoutDetail = 'redirected to ' + new URL(page.url()).host
    }
  }
  ok('checkout reaches Paystack', reachedPaystack, checkoutDetail)
  await shot(page, '5-checkout')

  await browser.close()

  const passed = results.filter((r) => r.pass).length
  console.log(`\n=== LIVE FLOW: ${passed}/${results.length} steps passed ===`)
  process.exit(passed === results.length ? 0 : 2)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
