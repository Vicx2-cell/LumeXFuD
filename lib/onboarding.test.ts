import { describe, expect, it } from 'vitest'
import {
  nextRiderReviewState,
  nextVendorReviewState,
  riderReadyForApproval,
  vendorReadyForApproval,
} from './onboarding'

describe('vendor onboarding helpers', () => {
  it('requires GPS pin and storefront photo before approval', () => {
    expect(vendorReadyForApproval({ official_latitude: 5.1, official_longitude: 7.2, storefront_photo_url: 'x', site_inspected: true })).toBe(true)
    expect(vendorReadyForApproval({ official_latitude: 5.1, official_longitude: 7.2, storefront_photo_url: null, site_inspected: true })).toBe(false)
    expect(vendorReadyForApproval({ official_latitude: null, official_longitude: 7.2, storefront_photo_url: 'x', site_inspected: true })).toBe(false)
  })

  it('advances vendor review states in the expected order', () => {
    expect(nextVendorReviewState('application_submitted', 'review')).toBe('under_review')
    expect(nextVendorReviewState('under_review', 'schedule_inspection')).toBe('inspection_scheduled')
    expect(nextVendorReviewState('inspection_scheduled', 'mark_inspected')).toBe('shop_inspected')
    expect(nextVendorReviewState('shop_inspected', 'approve')).toBe('approved')
    expect(nextVendorReviewState('approved', 'suspend')).toBe('suspended')
  })
})

describe('rider onboarding helpers', () => {
  it('requires identity and guarantor fields before approval', () => {
    expect(riderReadyForApproval({
      nin: '123',
      id_photo_url: 'id',
      live_selfie_url: 'selfie',
      guarantor_name: 'A',
      guarantor_phone: 'B',
      vehicle_type: 'bike',
    })).toBe(true)
    expect(riderReadyForApproval({
      nin: '',
      id_photo_url: 'id',
      live_selfie_url: 'selfie',
      guarantor_name: 'A',
      guarantor_phone: 'B',
      vehicle_type: 'bike',
    })).toBe(false)
  })

  it('advances rider review states in the expected order', () => {
    expect(nextRiderReviewState('application_submitted', 'review')).toBe('under_review')
    expect(nextRiderReviewState('under_review', 'verification_failed')).toBe('verification_failed')
    expect(nextRiderReviewState('verification_failed', 'approve')).toBe('approved')
    expect(nextRiderReviewState('approved', 'suspend')).toBe('suspended')
  })
})

