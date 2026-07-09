ALTER TABLE vendor_applications
  ADD COLUMN IF NOT EXISTS business_registration_status TEXT,
  ADD COLUMN IF NOT EXISTS cac_number TEXT,
  ADD COLUMN IF NOT EXISTS cac_document_url TEXT,
  ADD COLUMN IF NOT EXISTS verification_context TEXT;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS business_registration_status TEXT,
  ADD COLUMN IF NOT EXISTS cac_number TEXT,
  ADD COLUMN IF NOT EXISTS cac_document_url TEXT;
