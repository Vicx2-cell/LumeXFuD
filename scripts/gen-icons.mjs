// One-off: regenerate all app icons / favicons from the brand logo.
// Source is the amber X mark (crossed cutlery + sparkle).
// Run: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'preview.webp')

const out = (p) => path.join(root, 'public', p)

async function square(size) {
  return sharp(SRC).resize(size, size, { fit: 'cover' }).png()
}

async function run() {
  await (await square(192)).toFile(out('icons/icon-192.png'))
  await (await square(512)).toFile(out('icons/icon-512.png'))
  // Maskable: the logo already keeps the X inside a generous amber margin
  // (well within Android's inner-80% safe zone), so a straight edge-to-edge
  // resize is correct — no extra padding (which would only add a seam).
  await (await square(512)).toFile(out('icons/icon-512-maskable.png'))
  await (await square(180)).toFile(out('icons/apple-touch-icon.png'))

  // Browser-tab favicon via Next App Router conventions: app/icon.png is
  // auto-served as the favicon, app/apple-icon.png as the iOS touch icon.
  await (await square(512)).toFile(path.join(root, 'app', 'icon.png'))
  await (await square(180)).toFile(path.join(root, 'app', 'apple-icon.png'))

  console.log('Icons regenerated from', SRC)
}

run().catch((e) => { console.error(e); process.exit(1) })
