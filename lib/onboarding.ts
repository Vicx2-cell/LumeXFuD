export type VendorReviewState =
  | 'draft'
  | 'application_submitted'
  | 'under_review'
  | 'inspection_scheduled'
  | 'shop_inspected'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'pending_review'

export type RiderReviewState =
  | 'draft'
  | 'application_submitted'
  | 'under_review'
  | 'verification_failed'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'offline'
  | 'online'
  | 'on_delivery'
  | 'pending_review'

export type VendorReviewAction =
  | 'review'
  | 'schedule_inspection'
  | 'mark_inspected'
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'unsuspend'

export type RiderReviewAction =
  | 'review'
  | 'verification_failed'
  | 'approve'
  | 'reject'
  | 'suspend'
  | 'unsuspend'

export const VENDOR_VERIFICATION_CHECKS = [
  'contact_ownership',
  'government_identity',
  'business_ownership',
  'payout_account_match',
  'food_handler_clearance',
  'premises_hygiene',
  'safe_storage',
  'packaging_capacity',
  'menu_accuracy',
  'test_order',
] as const

export const RIDER_VERIFICATION_CHECKS = [
  'contact_ownership',
  'government_identity',
  'guarantor_confirmed',
  'payout_account_match',
  'vehicle_roadworthy',
  'safety_equipment',
  'smartphone_gps',
  'route_training',
  'test_delivery',
] as const

export type VerificationChecks = Record<string, boolean>

export function requiredChecksPassed(required: readonly string[], checks: VerificationChecks | null | undefined): boolean {
  return !!checks && required.every((key) => checks[key] === true)
}

export function normalizeVendorReviewState(state: string | null | undefined): VendorReviewState {
  switch (state) {
    case 'draft':
    case 'application_submitted':
    case 'under_review':
    case 'inspection_scheduled':
    case 'shop_inspected':
    case 'approved':
    case 'rejected':
    case 'suspended':
    case 'pending_review':
      return state as VendorReviewState
    default:
      return 'draft'
  }
}

export function normalizeRiderReviewState(state: string | null | undefined): RiderReviewState {
  switch (state) {
    case 'draft':
    case 'application_submitted':
    case 'under_review':
    case 'verification_failed':
    case 'approved':
    case 'rejected':
    case 'suspended':
    case 'offline':
    case 'online':
    case 'on_delivery':
    case 'pending_review':
      return state as RiderReviewState
    default:
      return 'draft'
  }
}

export function vendorReadyForApproval(input: {
  official_latitude?: number | null
  official_longitude?: number | null
  storefront_photo_url?: string | null
  site_inspected?: boolean | null
  verification_status?: string | null
  verification_checks?: VerificationChecks | null
}): boolean {
  return !!(
    input.site_inspected &&
    typeof input.official_latitude === 'number' &&
    Number.isFinite(input.official_latitude) &&
    typeof input.official_longitude === 'number' &&
    Number.isFinite(input.official_longitude) &&
    input.storefront_photo_url &&
    input.storefront_photo_url.trim() &&
    input.verification_status === 'verified' &&
    requiredChecksPassed(VENDOR_VERIFICATION_CHECKS, input.verification_checks)
  )
}

export function riderReadyForApproval(input: {
  nin?: string | null
  id_photo_url?: string | null
  live_selfie_url?: string | null
  guarantor_name?: string | null
  guarantor_phone?: string | null
  vehicle_type?: string | null
  verification_status?: string | null
  verification_checks?: VerificationChecks | null
}): boolean {
  return !!(
    input.nin && input.nin.trim() &&
    input.id_photo_url && input.id_photo_url.trim() &&
    input.live_selfie_url && input.live_selfie_url.trim() &&
    input.guarantor_name && input.guarantor_name.trim() &&
    input.guarantor_phone && input.guarantor_phone.trim() &&
    input.vehicle_type && input.vehicle_type.trim() &&
    input.verification_status === 'verified' &&
    requiredChecksPassed(RIDER_VERIFICATION_CHECKS, input.verification_checks)
  )
}

export function nextVendorReviewState(current: string | null | undefined, action: VendorReviewAction): VendorReviewState {
  const state = normalizeVendorReviewState(current)
  switch (action) {
    case 'review':
      return 'under_review'
    case 'schedule_inspection':
      return 'inspection_scheduled'
    case 'mark_inspected':
      return 'shop_inspected'
    case 'approve':
      return 'approved'
    case 'reject':
      return 'rejected'
    case 'suspend':
      return 'suspended'
    case 'unsuspend':
      return state === 'rejected' ? 'under_review' : 'approved'
  }
  return state
}

export function nextRiderReviewState(current: string | null | undefined, action: RiderReviewAction): RiderReviewState {
  const state = normalizeRiderReviewState(current)
  switch (action) {
    case 'review':
      return 'under_review'
    case 'verification_failed':
      return 'verification_failed'
    case 'approve':
      return 'approved'
    case 'reject':
      return 'rejected'
    case 'suspend':
      return 'suspended'
    case 'unsuspend':
      return state === 'rejected' ? 'under_review' : 'approved'
  }
  return state
}
