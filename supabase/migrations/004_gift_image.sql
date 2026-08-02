-- 004_gift_image.sql
-- Foto do brinde
-- Rode após 001_initial_schema.sql

ALTER TABLE gifts
ADD COLUMN IF NOT EXISTS image_url TEXT;
