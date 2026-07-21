import { beforeAll, describe, expect, it } from 'vitest'
import { signEmailVerified, verifyEmailVerified } from './email-verify'

describe('email ownership proof', () => {
  beforeAll(() => { process.env.JWT_SECRET = 'test-only-email-verification-secret-with-enough-length' })

  it('is bound to the normalized address and intended workflow', async () => {
    const token = await signEmailVerified(' Owner@Example.com ', 'signup')
    await expect(verifyEmailVerified(token, 'owner@example.com', 'signup')).resolves.toBe(true)
    await expect(verifyEmailVerified(token, 'other@example.com', 'signup')).resolves.toBe(false)
    await expect(verifyEmailVerified(token, 'owner@example.com', 'application')).resolves.toBe(false)
  })

  it('rejects missing or malformed proofs', async () => {
    await expect(verifyEmailVerified(undefined, 'owner@example.com', 'signup')).resolves.toBe(false)
    await expect(verifyEmailVerified('not-a-token', 'owner@example.com', 'signup')).resolves.toBe(false)
  })
})
