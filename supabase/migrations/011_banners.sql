-- 011_banners.sql
-- Banner padrão da loja e banners opcionais por promoção

ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS default_banner_url TEXT;

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS banner_url TEXT,
    ADD COLUMN IF NOT EXISTS show_banner BOOLEAN NOT NULL DEFAULT false;
