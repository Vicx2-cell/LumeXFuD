const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const OUT = path.join(process.cwd(), 'tiktok-demo-lumex-fud.mp4')

const slides = [
  {
    file: path.join(process.cwd(), 'screenshots', 'live', '1-home.png'),
    title: 'Browse local vendors',
    subtitle: 'Discover meals, vendors, and live availability.',
  },
  {
    file: path.join(process.cwd(), 'screenshots', 'live', '2-vendor.png'),
    title: 'Choose your food',
    subtitle: 'Open a vendor page and pick the items you want.',
  },
  {
    file: path.join(process.cwd(), 'screenshots', 'live', '3-vendor-after-add.png'),
    title: 'Add to cart',
    subtitle: 'Build the order before heading to checkout.',
  },
  {
    file: path.join(process.cwd(), 'screenshots', 'live', '4-cart.png'),
    title: 'Review your cart',
    subtitle: 'Check items, quantities, and delivery details.',
  },
  {
    file: path.join(process.cwd(), 'screenshots', 'live', '5-checkout.png'),
    title: 'Checkout securely',
    subtitle: 'Finish the order and get ready for delivery.',
  },
]

function toDataUrl(file) {
  const ext = path.extname(file).slice(1) || 'png'
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

async function main() {
  for (const slide of slides) {
    if (!fs.existsSync(slide.file)) throw new Error(`Missing screenshot: ${slide.file}`)
    slide.src = toDataUrl(slide.file)
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #070707; }
        body { display: grid; place-items: center; font-family: Inter, Arial, sans-serif; }
        canvas { width: 1280px; height: 720px; image-rendering: auto; }
      </style>
    </head>
    <body>
      <canvas id="c" width="1280" height="720"></canvas>
      <script>
        const slides = ${JSON.stringify(slides.map(({ src, title, subtitle }) => ({ src, title, subtitle })))}
        const canvas = document.getElementById('c')
        const ctx = canvas.getContext('2d')
        const W = canvas.width, H = canvas.height
        const bg = '#070707'
        const totalMs = 18000
        const slideMs = 3500
        const fadeMs = 800

        function loadImage(src) {
          return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = src
          })
        }

        function cover(img, x, y, w, h, zoom = 1) {
          const scale = Math.max(w / img.width, h / img.height) * zoom
          const dw = img.width * scale
          const dh = img.height * scale
          const dx = x + (w - dw) / 2
          const dy = y + (h - dh) / 2
          ctx.drawImage(img, dx, dy, dw, dh)
        }

        function roundRect(x, y, w, h, r) {
          const rr = Math.min(r, w / 2, h / 2)
          ctx.beginPath()
          ctx.moveTo(x + rr, y)
          ctx.arcTo(x + w, y, x + w, y + h, rr)
          ctx.arcTo(x + w, y + h, x, y + h, rr)
          ctx.arcTo(x, y + h, x, y, rr)
          ctx.arcTo(x, y, x + w, y, rr)
          ctx.closePath()
        }

        function drawFrame(img, title, subtitle, t, alpha = 1, pan = 0) {
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, W, H)

          // Soft radial glow for a more polished presentation.
          const grad = ctx.createRadialGradient(W * 0.5, H * 0.45, 30, W * 0.5, H * 0.45, 600)
          grad.addColorStop(0, 'rgba(245,166,35,0.10)')
          grad.addColorStop(1, 'rgba(245,166,35,0)')
          ctx.fillStyle = grad
          ctx.fillRect(0, 0, W, H)

          const frameX = 92
          const frameY = 46
          const frameW = W - 184
          const frameH = H - 122
          ctx.shadowColor = 'rgba(0,0,0,0.45)'
          ctx.shadowBlur = 30
          ctx.shadowOffsetY = 18
          ctx.fillStyle = '#111'
          roundRect(frameX, frameY, frameW, frameH, 24)
          ctx.fill()
          ctx.shadowColor = 'transparent'

          // Browser top bar.
          ctx.fillStyle = '#191919'
          roundRect(frameX, frameY, frameW, 54, 24)
          ctx.fill()
          ctx.fillStyle = '#2c2c2c'
          ctx.fillRect(frameX, frameY + 28, frameW, 26)
          ctx.fillStyle = '#f5f5f5'
          ctx.font = '600 18px Arial, sans-serif'
          ctx.fillText('Lumex Fud', frameX + 22, frameY + 34)
          ctx.fillStyle = '#8f8f8f'
          ctx.font = '14px Arial, sans-serif'
          ctx.fillText('https://lumexfud.com.ng', frameX + 140, frameY + 35)

          // Screenshot area.
          const innerX = frameX + 16
          const innerY = frameY + 70
          const innerW = frameW - 32
          const innerH = frameH - 90
          ctx.save()
          roundRect(innerX, innerY, innerW, innerH, 18)
          ctx.clip()
          cover(img, innerX, innerY, innerW, innerH, 1 + pan)
          ctx.restore()

          // Caption card.
          ctx.fillStyle = 'rgba(8,8,8,0.72)'
          roundRect(116, 560, 1048, 104, 26)
          ctx.fill()
          ctx.fillStyle = '#f5a623'
          ctx.font = '700 26px Arial, sans-serif'
          ctx.fillText(title, 152, 605)
          ctx.fillStyle = '#f2f2f2'
          ctx.font = '400 18px Arial, sans-serif'
          ctx.fillText(subtitle, 152, 634)

          // Step indicator.
          ctx.fillStyle = '#f5a623'
          roundRect(1004, 582, 120, 46, 999)
          ctx.fill()
          ctx.fillStyle = '#101010'
          ctx.font = '700 16px Arial, sans-serif'
          ctx.fillText('Demo', 1038, 611)
          ctx.restore()
        }

        async function run() {
          const imgs = await Promise.all(slides.map((s) => loadImage(s.src)))

          let recorder
          const stream = canvas.captureStream(30)
          const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
          const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t))
          recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 })

          const blobs = []
          recorder.ondataavailable = (event) => {
            if (!event.data || !event.data.size) return
            blobs.push(event.data)
          }
          recorder.start(1000)

          const start = performance.now()
          function render(now) {
            const elapsed = now - start
            const idx = Math.min(Math.floor(elapsed / slideMs), imgs.length - 1)
            const local = elapsed % slideMs
            const fadeIn = Math.min(1, local / fadeMs)
            const fadeOut = Math.min(1, (slideMs - local) / fadeMs)
            const alpha = Math.min(fadeIn, fadeOut)
            const next = Math.min(idx + 1, imgs.length - 1)
            const pan = 0.015 * Math.sin(elapsed / 1200)
            drawFrame(imgs[idx], slides[idx].title, slides[idx].subtitle, elapsed, 1, pan)
            if (local > slideMs - fadeMs && next !== idx) {
              const nextAlpha = 1 - fadeOut
              drawFrame(imgs[next], slides[next].title, slides[next].subtitle, elapsed, nextAlpha, -pan)
            }
            if (elapsed < totalMs) {
              requestAnimationFrame(render)
            } else {
              recorder.stop()
            }
          }

          recorder.onstop = async () => {
            window.__videoBlob = new Blob(blobs, { type: mimeType || 'video/mp4' })
            window.__videoReady = true
          }

          requestAnimationFrame(render)
        }

        run().catch((err) => {
          document.body.innerHTML = '<pre style="color:#fff;white-space:pre-wrap;padding:24px">' + String(err && err.stack || err) + '</pre>'
        })
      </script>
    </body>
  </html>`

  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__videoReady === true, null, { timeout: 240000 })
  const b64 = await page.evaluate(async () => {
    const blob = window.__videoBlob
    const ab = await blob.arrayBuffer()
    const bytes = new Uint8Array(ab)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  })
  fs.writeFileSync(OUT, Buffer.from(b64, 'base64'))
  await browser.close()
  console.log(OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
