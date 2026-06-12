import { chromium } from 'playwright'
const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:3000'
const b = await chromium.launch()
const p = await b.newContext({ viewport: { width: 375, height: 812 } }).then(c => c.newPage())
await p.goto(`${BASE}/auth`, { waitUntil: 'networkidle' })
const btn = await p.getByRole('button', { name: /continue/i }).first()
const cs = await btn.evaluate(el => {
  const s = getComputedStyle(el)
  return { bg: s.backgroundColor, color: s.color, radius: s.borderRadius, shadow: s.boxShadow, cls: el.className }
})
const card = await p.locator('.glass').first().evaluate(el => {
  const s = getComputedStyle(el)
  return { bg: s.backgroundColor, backdrop: s.backdropFilter, border: s.borderTopWidth, cls: el.className }
}).catch(e => 'NO .glass element: ' + e.message)
const orb = await p.locator('.lx-orb').first().evaluate(el => {
  const s = getComputedStyle(el)
  return { bg: s.backgroundColor, blur: s.filter, pos: s.position }
}).catch(e => 'NO .lx-orb: ' + e.message)
console.log('BUTTON', JSON.stringify(cs))
console.log('CARD  ', JSON.stringify(card))
console.log('ORB   ', JSON.stringify(orb))
await b.close()
