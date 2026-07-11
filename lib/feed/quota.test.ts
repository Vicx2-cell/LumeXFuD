import { describe, expect, it } from 'vitest'
import { assessVideoQuota, getVideoQuotaLimit } from './quota'

describe('feed video quota', () => {
  it('uses the free-vendor active video limit by default', () => {
    expect(getVideoQuotaLimit(false).limit).toBe(60)
    expect(assessVideoQuota(59, false).canPublish).toBe(true)
    expect(assessVideoQuota(60, false).canPublish).toBe(false)
  })

  it('supports premium unlimited mode', () => {
    const status = assessVideoQuota(500, true, {
      freeActiveVideoLimit: 60,
      premiumActiveVideoLimit: 120,
      premiumUnlimitedVideos: true,
    })

    expect(status.unlimited).toBe(true)
    expect(status.remaining).toBeNull()
    expect(status.canPublish).toBe(true)
  })

  it('uses the premium quota when unlimited is disabled', () => {
    const status = assessVideoQuota(119, true, {
      freeActiveVideoLimit: 60,
      premiumActiveVideoLimit: 120,
      premiumUnlimitedVideos: false,
    })

    expect(status.limit).toBe(120)
    expect(status.remaining).toBe(1)
    expect(status.canPublish).toBe(true)
    expect(assessVideoQuota(120, true, {
      freeActiveVideoLimit: 60,
      premiumActiveVideoLimit: 120,
      premiumUnlimitedVideos: false,
    }).canPublish).toBe(false)
  })
})
