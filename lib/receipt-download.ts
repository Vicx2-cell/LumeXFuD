// Renders a branded, professional payment receipt as a PNG and triggers a
// download — no external library (keeps the bundle + CSP clean). Drawn on a
// canvas at 2× for crisp text; shareable on WhatsApp / saveable to Files.
//
// The reference + verification code are shown IN FULL (wrapped, never truncated)
// so a receipt can actually be verified later by an admin.

export interface ReceiptDownload {
  title: string                 // "Payment Receipt"
  party: string                 // "LumeX Wallet"
  amountLine: string            // "+₦1,200"
  amountPositive: boolean
  rows: Array<[string, string]> // short label/value pairs only
  reference: string             // full transaction reference
  code: string                  // verification code
  refName: string               // safe filename fragment
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Break a no-space string (reference) into lines that fit maxW at the current font.
function wrapChars(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch }
    else cur += ch
  }
  if (cur) lines.push(cur)
  return lines
}

export function downloadReceiptPng(d: ReceiptDownload): void {
  const S = 2
  const W = 400
  const sans = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  const mono = 'ui-monospace, Menlo, monospace'
  const ink = '#0A0A0B'
  const muted = '#6b7280'

  // Measure the reference wrap up front (need a context) to size the canvas.
  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = `600 12px ${mono}`
  const refLines = wrapChars(meas, d.reference, W - 56)

  const rowsTop = 250
  const rowH = 30
  const refTop = rowsTop + d.rows.length * rowH + 6
  const refH = 20 + refLines.length * 16 + 8
  const vbTop = refTop + refH + 6
  const H = vbTop + 64 + 54

  const canvas = document.createElement('canvas')
  canvas.width = W * S
  canvas.height = H * S
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(S, S)

  // Card
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)

  // Amber header
  ctx.fillStyle = '#F5A623'; ctx.fillRect(0, 0, W, 76)
  ctx.fillStyle = ink; ctx.font = `700 22px ${sans}`; ctx.fillText('LumeX Fud', 28, 40)
  ctx.font = `500 12px ${sans}`; ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillText('Campus life, simplified.', 28, 59)

  // Title + party
  ctx.fillStyle = ink; ctx.font = `700 16px ${sans}`; ctx.fillText(d.title, 28, 116)
  ctx.fillStyle = muted; ctx.font = `400 12px ${sans}`; ctx.fillText(d.party, 28, 135)

  // Big amount
  ctx.fillStyle = d.amountPositive ? '#16a34a' : ink
  ctx.font = `700 34px ${sans}`; ctx.fillText(d.amountLine, 28, 184)

  // Divider
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(28, 212); ctx.lineTo(W - 28, 212); ctx.stroke()

  // Short rows
  let y = rowsTop
  ctx.font = `400 13px ${sans}`
  for (const [k, v] of d.rows) {
    ctx.textAlign = 'left'; ctx.fillStyle = muted; ctx.fillText(k, 28, y)
    ctx.textAlign = 'right'; ctx.fillStyle = ink; ctx.fillText(v, W - 28, y)
    y += rowH
  }
  ctx.textAlign = 'left'

  // Reference — full, wrapped, monospace
  ctx.fillStyle = muted; ctx.font = `400 12px ${sans}`; ctx.fillText('Reference', 28, refTop + 4)
  ctx.fillStyle = ink; ctx.font = `600 12px ${mono}`
  let ry = refTop + 22
  for (const line of refLines) { ctx.fillText(line, 28, ry); ry += 16 }

  // Verification box
  ctx.fillStyle = '#f3f4f6'; roundRect(ctx, 28, vbTop, W - 56, 64, 10); ctx.fill()
  ctx.fillStyle = '#16a34a'; ctx.font = `600 12px ${sans}`; ctx.fillText('✓ Tamper-proof verification', 44, vbTop + 26)
  ctx.fillStyle = ink; ctx.font = `700 16px ${mono}`; ctx.fillText(d.code, 44, vbTop + 50)

  // Footer
  ctx.textAlign = 'center'; ctx.fillStyle = '#9ca3af'; ctx.font = `400 11px ${sans}`
  ctx.fillText('Issued by LumeX Fud · lumexfud.com.ng', W / 2, H - 30)
  ctx.fillText(new Date().toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), W / 2, H - 14)
  ctx.textAlign = 'left'

  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `LumeX-Receipt-${d.refName || 'txn'}.png`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
