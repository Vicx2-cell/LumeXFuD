// Generates lib/route-manifest.json — a list of every API route in the codebase
// (path, exported HTTP methods, whether the path is dynamic). The Sentinel reads
// this to sweep the whole surface, so it always reflects the actual code. Runs
// automatically before every build (package.json "prebuild").
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const apiDir = join(root, 'app', 'api')

function walk(dir) {
  let out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (entry === 'route.ts' || entry === 'route.tsx') out.push(p)
  }
  return out
}

const METHOD_RE = /export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g

const routes = walk(apiDir)
  .map((file) => {
    const rel = relative(join(root, 'app'), file).split(sep).join('/')
    const path = '/' + rel.replace(/\/route\.(ts|tsx)$/, '')
    const src = readFileSync(file, 'utf8')
    const methods = [...new Set([...src.matchAll(METHOD_RE)].map((m) => m[1]))]
    return { path, dynamic: path.includes('['), methods }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

writeFileSync(
  join(root, 'lib', 'route-manifest.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), count: routes.length, routes }, null, 2) + '\n'
)
console.log(`route-manifest: ${routes.length} API routes`)
