-- 002_storage.sql
-- Bucket de imagens + políticas de acesso
-- Rode após 001_initial_schema.sql

INSERT INTO storage.buckets (id, name, public)
VALUES ('store-assets', 'store-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read store assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'store-assets');

CREATE POLICY "Auth upload store assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'store-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Auth update store assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'store-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Auth delete store assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'store-assets' AND auth.role() = 'authenticated');
