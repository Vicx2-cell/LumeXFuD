import { describe, expect, it } from 'vitest'

import { normalizeSentryDsn } from './sentry-scrub'

describe('normalizeSentryDsn', () => {
  it('removes a byte-order mark and surrounding whitespace', () => {
    expect(normalizeSentryDsn('\uFEFF https://examplePublicKey@sentry.example/1 \r\n')).toBe(
      'https://examplePublicKey@sentry.example/1',
    )
  })

  it('disables empty values', () => {
    expect(normalizeSentryDsn(' \uFEFF ')).toBeUndefined()
    expect(normalizeSentryDsn(undefined)).toBeUndefined()
  })
})
