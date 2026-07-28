import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8')

describe('guest ordering entry contract', () => {
  it('keeps the marketplace public and makes browsing the primary landing action', () => {
    const proxy = read('proxy.ts')
    const hero = read('components', 'hero', 'Hero.tsx')
    expect(proxy).not.toContain('pattern: /^\\/home(\\/|$)/')
    expect(hero).toContain('href="/home"')
    expect(hero).toContain('Browse restaurants')
  })

  it('keeps guest marketplace interactions to browsing and canonical storefront links', () => {
    const home = read('app', 'home', 'page.tsx')
    const marketplace = read('app', 'homepage-client.tsx')
    expect(home).toContain("canManageFavorites={session?.role === 'customer'}")
    expect(marketplace).toContain('vendor.slug ? storePath(vendor.slug)')
    expect(marketplace).toContain('{canManageFavorites && <button')
  })
})
