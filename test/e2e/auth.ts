import type { Page } from 'playwright/test'
import { SignJWT } from 'jose'
import { playwrightIdentities } from '../../lib/supabase/playwright-commerce-fixture'

export type FixtureRole = keyof typeof playwrightIdentities

const secret = new TextEncoder().encode('playwright-commerce-fixture-secret-000000000000000000000000')

export async function authenticateAs(page: Page, role: FixtureRole) {
  const identity = playwrightIdentities[role]
  const token = await new SignJWT({ ...identity })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(secret)

  await page.context().addCookies([{
    name: 'session',
    value: token,
    url: 'http://127.0.0.1:3187',
    httpOnly: true,
    sameSite: 'Lax',
  }])
}
