-- 012_product_sizes_and_galleries.sql
-- Estoque por tamanho (P/M/G) e galerias de fotos

CREATE TABLE IF NOT EXISTS product_sizes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size TEXT NOT NULL CHECK (size IN ('P', 'M', 'G')),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    UNIQUE (product_id, size)
);

CREATE INDEX IF NOT EXISTS idx_product_sizes_product ON product_sizes(product_id);

ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}';

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}';

-- Migra foto única de brinde para array
UPDATE gifts
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND image_url <> ''
  AND (image_urls IS NULL OR image_urls = '{}');

-- Estoque por tamanho a partir dos produtos existentes
INSERT INTO product_sizes (product_id, size, stock)
SELECT
    p.id,
    s.size,
    CASE
        WHEN UPPER(TRIM(COALESCE(p.size, ''))) = s.size THEN GREATEST(p.stock, 0)
        WHEN UPPER(TRIM(COALESCE(p.size, ''))) NOT IN ('P', 'M', 'G')
             AND s.size = 'M' THEN GREATEST(p.stock, 0)
        ELSE 0
    END
FROM products p
CROSS JOIN (VALUES ('P'), ('M'), ('G')) AS s(size)
ON CONFLICT (product_id, size) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_product_stock_from_sizes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id UUID;
BEGIN
    v_product_id := COALESCE(NEW.product_id, OLD.product_id);
    UPDATE products
    SET stock = COALESCE(
            (SELECT SUM(stock) FROM product_sizes WHERE product_id = v_product_id),
            0
        ),
        updated_at = NOW()
    WHERE id = v_product_id;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_stock ON product_sizes;
CREATE TRIGGER trg_sync_product_stock
    AFTER INSERT OR UPDATE OR DELETE ON product_sizes
    FOR EACH ROW
    EXECUTE FUNCTION sync_product_stock_from_sizes();

UPDATE products p
SET stock = COALESCE(
    (SELECT SUM(ps.stock) FROM product_sizes ps WHERE ps.product_id = p.id),
    p.stock
);

ALTER TABLE product_sizes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_sizes_public_read" ON product_sizes;
CREATE POLICY "product_sizes_public_read" ON product_sizes
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "product_sizes_auth_all" ON product_sizes;
CREATE POLICY "product_sizes_auth_all" ON product_sizes
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
