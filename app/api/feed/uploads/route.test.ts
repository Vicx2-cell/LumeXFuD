import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  canCreateStory: vi.fn(),
  canPublishFeedPost: vi.fn(),
}))

vi.mock('@/lib/features', () => ({ getFeature: vi.fn(async () => true) }))
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => ({ role: 'customer', userId: 'customer-1', phone: '+2348000000000' })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/feed/service', () => ({ ensureSocialProfileForSession: vi.fn(async () => ({ id: 'profile-1' })) }))
vi.mock('@/lib/feed/permissions', () => ({
  loadFeedPermissionContext: vi.fn(async () => ({ profile: { id: 'profile-1' }, vendor: null })),
  canCreateStory: mocks.canCreateStory,
  canPublishFeedPost: mocks.canPublishFeedPost,
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    storage: {
      getBucket: vi.fn(async () => ({ data: { id: 'feed-media' }, error: null })),
      createBucket: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(() => ({
        createSignedUploadUrl: mocks.createSignedUploadUrl,
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } })),
      })),
    },
  })),
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/feed/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('feed signed video uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canCreateStory.mockReturnValue(true)
    mocks.canPublishFeedPost.mockReturnValue(true)
    mocks.createSignedUploadUrl.mockResolvedValue({ data: { token: 'signed-token' }, error: null })
  })

  it('prepares an account-scoped direct upload instead of receiving the video body', async () => {
    const res = await POST(request({
      action: 'prepare_video',
      file_name: 'story.mov',
      mime_type: 'video/quicktime',
      size_bytes: 25 * 1024 * 1024,
      duration_seconds: 32,
      purpose: 'story',
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.storage_path).toMatch(/^profile-1\/[a-f0-9-]+\.mov$/)
    expect(json.upload_token).toBe('signed-token')
    expect(json.public_url).toContain(json.storage_path)
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledOnce()
  })

  it('rejects oversized videos before issuing an upload token', async () => {
    const res = await POST(request({
      action: 'prepare_video',
      file_name: 'large.mp4',
      mime_type: 'video/mp4',
      size_bytes: 101 * 1024 * 1024,
      duration_seconds: 30,
      purpose: 'story',
    }))

    expect(res.status).toBe(400)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('does not issue upload tokens to blocked account types', async () => {
    mocks.canCreateStory.mockReturnValue(false)
    const res = await POST(request({
      action: 'prepare_video',
      file_name: 'blocked.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      duration_seconds: 10,
      purpose: 'story',
    }))

    expect(res.status).toBe(403)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})
