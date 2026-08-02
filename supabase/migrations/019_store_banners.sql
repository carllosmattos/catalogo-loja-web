-- 019_store_banners.sql
-- Banners da loja: vários ativos formam carrossel no catálogo

CREATE TABLE IF NOT EXISTS store_banners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    image_url TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_banners_public_read" ON store_banners
    FOR SELECT USING (active = true);

CREATE POLICY "store_banners_auth_all" ON store_banners
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_store_banners_active_sort
    ON store_banners (active, sort_order, created_at);

-- Migra banner único legado (default_banner_url) se existir
INSERT INTO store_banners (image_url, active, sort_order)
SELECT default_banner_url, true, 0
FROM store_settings
WHERE default_banner_url IS NOT NULL
  AND TRIM(default_banner_url) <> ''
  AND NOT EXISTS (SELECT 1 FROM store_banners LIMIT 1);
