ALTER TABLE public.lumi_unmatched_messages
  ADD COLUMN IF NOT EXISTS normalized_message text,
  ADD COLUMN IF NOT EXISTS active_step text;

ALTER TABLE public.lumi_unmatched_messages
  ALTER COLUMN message TYPE text;

CREATE INDEX IF NOT EXISTS idx_lumi_unmatched_created_at
  ON public.lumi_unmatched_messages(created_at DESC);
