// KYC document catalog for vendors & riders. Each doc is stored in the private
// `kyc-faces` bucket at  <state>/<userId>/<key>.webp  (state = pending | verified).
// No DB table — the object's folder IS its verification state.

export interface KycDoc { key: string; label: string; hint: string; emoji: string }

export const KYC_DOCS: Record<'vendor' | 'rider', KycDoc[]> = {
  vendor: [
    { key: 'face',    label: 'Your selfie',   hint: 'A clear photo of your face',                         emoji: '🤳' },
    { key: 'id_card', label: 'Government ID',  hint: 'NIN slip, voter’s card or driver’s licence',         emoji: '🪪' },
    { key: 'shop',    label: 'Shop photo',     hint: 'Your kitchen / shop front',                          emoji: '🏪' },
  ],
  rider: [
    { key: 'face',    label: 'Your selfie',   hint: 'A clear photo of your face',                         emoji: '🤳' },
    { key: 'id_card', label: 'Government ID',  hint: 'NIN slip, voter’s card or driver’s licence',         emoji: '🪪' },
    { key: 'bike',    label: 'Bike & plate',   hint: 'Your bike with the plate number clearly visible',    emoji: '🏍️' },
  ],
}

export type DocState = 'verified' | 'pending' | 'none'

export function docsForRole(role: string): KycDoc[] {
  return role === 'vendor' ? KYC_DOCS.vendor : role === 'rider' ? KYC_DOCS.rider : []
}

export function isValidDoc(role: string, key: string): boolean {
  return docsForRole(role).some((d) => d.key === key)
}

// Label lookup across both roles (admin queue shows docs without knowing role yet).
export function docLabel(key: string): string {
  for (const list of Object.values(KYC_DOCS)) {
    const d = list.find((x) => x.key === key)
    if (d) return d.label
  }
  return key
}
