import { describe, expect, it } from 'vitest'

import { validateEnv } from '@/lib/env'

describe('environment validation', () => {
  it('allows an immutable host to compile before runtime secrets are attached', () => {
    expect(() => validateEnv({ npm_lifecycle_event: 'build' })).not.toThrow()
  })

  it('still fails closed when the deployed server starts without secrets', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /Missing required environment variables/
    )
  })

  it('does not treat other npm lifecycle events as a build', () => {
    expect(() => validateEnv({ npm_lifecycle_event: 'start', NODE_ENV: 'production' })).toThrow(
      /Missing required environment variables/
    )
  })
})
