-- Admin-editable price bands for affordable discovery. Values are integer kobo.
INSERT INTO public.settings (id, value)
VALUES ('affordable_discovery_thresholds_kobo', '{"values_kobo":[100000,150000,200000,300000]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
