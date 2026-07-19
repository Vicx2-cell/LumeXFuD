-- Review-only cleanup script for clearly internal/test feed records.
-- This file targets exact record IDs only and should be reviewed before any execution.
--
-- Intended action if approved:
--   archive posts by setting status = 'archived'
--   preserve records for audit/history

BEGIN;

SELECT
  id,
  author_profile_id,
  author_handle,
  author_display_name,
  body,
  post_kind
FROM posts
WHERE id IN (
  '1001d71b-9d80-4184-9597-f13055e87ece',
  '28df6489-9ab5-413b-8f7b-d02e39445deb',
  'fab85997-3fc9-45e4-bea7-e1ed0c92dd24',
  'e9630f0b-03c2-4613-b6b9-bf41f4da78ab',
  '848a6b95-d023-41c6-81a4-a7e5391dc2b5',
  'dbabf6a7-bece-46a4-9bd5-0fb9abbc7f97',
  'b2562710-021c-4483-a31f-00f54a2d61b3',
  '14ead7aa-e3c7-4625-bde2-17f686d26ee3',
  'f1e5a1ba-70b1-4b0d-a0e7-1230fa1ef5aa'
);

-- Uncomment only after review/approval:
-- UPDATE posts
-- SET status = 'archived',
--     archived_at = NOW()
-- WHERE id IN (
--   '1001d71b-9d80-4184-9597-f13055e87ece',
--   '28df6489-9ab5-413b-8f7b-d02e39445deb',
--   'fab85997-3fc9-45e4-bea7-e1ed0c92dd24',
--   'e9630f0b-03c2-4613-b6b9-bf41f4da78ab',
--   '848a6b95-d023-41c6-81a4-a7e5391dc2b5',
--   'dbabf6a7-bece-46a4-9bd5-0fb9abbc7f97',
--   'b2562710-021c-4483-a31f-00f54a2d61b3',
--   '14ead7aa-e3c7-4625-bde2-17f686d26ee3',
--   'f1e5a1ba-70b1-4b0d-a0e7-1230fa1ef5aa'
-- );

ROLLBACK;
