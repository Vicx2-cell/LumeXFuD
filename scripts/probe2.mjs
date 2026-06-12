import { chromium } from 'playwright'
const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:3000'
const b = await chromium.launch()
const p = await b.newContext().then(c => c.newPage())
await p.goto(`${BASE}/auth`, { waitUntil: 'networkidle' })
const found = await p.evaluate(() => {
  const hits = { glass: 0, btn: 0, orb: 0, root: 0, total: 0 }
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) {
      hits.total++
      const t = r.cssText || ''
      if (t.includes('.glass')) hits.glass++
      if (t.includes('lx-btn-amber')) hits.btn++
      if (t.includes('lx-orb')) hits.orb++
      if (t.includes('--color-amber')) hits.root++
    }
  }
  return hits
})
console.log(JSON.stringify(found))
await b.close()
