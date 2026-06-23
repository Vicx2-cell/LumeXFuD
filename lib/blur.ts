// A tiny (150-byte) dark PNG used as the `blurDataURL` for remote food/vendor
// images. Next.js can't generate a blur placeholder for remote Supabase images at
// build time, so we supply this shared one: instead of a white box flashing in
// while the photo loads, the slot shows a dark amber-tinted tile that the photo
// fades over — Instagram-style, zero layout shift. Kept deliberately tiny (an 8×8
// solid #17120c upscaled + blurred by next/image) so it adds no real weight.
export const FOOD_BLUR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQF+LBihiGlgQAMNMNQXmXCkAAAAAASUVORK5CYII='
