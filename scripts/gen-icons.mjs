// One-off: regenerate all app icons / favicons from the brand logo.
// Source is the amber X mark (crossed cutlery + sparkle).
// Run: node scripts/gen-icons.mjs [path-to-source-image]
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'preview.webp')

const out = (p) => path.join(root, 'public', p)
// ensureAlpha → RGBA output. Turbopack's .ico decoder rejects RGB-only PNGs
// ("The PNG is not in RGBA format!").
const png = (size) => sharp(SRC).resize(size, size, { fit: 'cover' }).ensureAlpha().png().toBuffer()
// Apple touch icon: NO alpha channel at all. iOS composites any alpha onto
// black and, when the icon fails to load, falls back to a black screenshot of
// the page — so flatten onto a solid background to keep the home-screen icon
// reliably amber.
const flatPng = (size) => sharp(SRC).resize(size, size, { fit: 'cover' }).flatten({ background: '#F5A623' }).png().toBuffer()

// Pack several PNG frames into a single multi-size .ico so browsers render a
// purpose-built 16/32/48 tab icon instead of squashing the 192px PWA icon
// (which looks like a colourless blob at favicon size).
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)            // type: icon
  header.writeUInt16LE(frames.length, 4)
  const dir = Buffer.alloc(frames.length * 16)
  let offset = 6 + dir.length
  frames.forEach((f, i) => {
    const o = i * 16
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, o)     // width  (0 == 256)
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, o + 1) // height
    dir.writeUInt16LE(1, o + 4)         // colour planes
    dir.writeUInt16LE(32, o + 6)        // bits per pixel
    dir.writeUInt32LE(f.buf.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += f.buf.length
  })
  return Buffer.concat([header, dir, ...frames.map((f) => f.buf)])
}

async function run() {
  // PWA / Android icons. NOTE: the filenames carry a version suffix (-v2). When
  // the brand changes, BUMP the suffix and update the references (manifest,
  // layout metadata, components) — a brand-new URL is the only bulletproof way
  // to stop Android's WebAPK minter / any HTTP cache from serving a stale icon.
  // FLATTENED (no alpha): a transparent pixel in a maskable/adaptive icon lets
  // the launcher's background layer (manifest background_color) show through as
  // black. Flattening guarantees a solid amber field behind the X.
  await writeFile(out('icons/icon-192-v2.png'), await flatPng(192))
  await writeFile(out('icons/icon-512-v2.png'), await flatPng(512))
  // Maskable: the logo already keeps the X inside a generous amber margin
  // (well within Android's inner-80% safe zone), so a straight edge-to-edge
  // resize is correct — no extra padding (which would only add a seam).
  await writeFile(out('icons/icon-maskable-512-v2.png'), await flatPng(512))
  // apple-touch-icon: flattened (no alpha). Written to the site root too —
  // iOS checks /apple-touch-icon.png by convention, and a fresh root path also
  // sidesteps any icon iOS cached under the old /icons/ URL.
  const apple = await flatPng(180)
  await writeFile(out('icons/apple-touch-icon.png'), apple)
  await writeFile(out('apple-touch-icon.png'), apple)

  // Browser-tab favicon: multi-size .ico served at /favicon.ico by Next.
  const ico = buildIco([
    { size: 16, buf: await png(16) },
    { size: 32, buf: await png(32) },
    { size: 48, buf: await png(48) },
  ])
  await writeFile(path.join(root, 'app', 'favicon.ico'), ico)

  console.log('Icons regenerated from', SRC)
}

run().catch((e) => { console.error(e); process.exit(1) })
