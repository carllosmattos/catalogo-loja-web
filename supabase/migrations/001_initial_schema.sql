-- 001_initial_schema.sql
-- Catálogo de Roupas — schema inicial
-- Projeto novo: rode este arquivo primeiro no SQL Editor do Supabase.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELAS
-- ============================================================

CREATE TABLE IF NOT EXISTS store_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_name TEXT NOT NULL DEFAULT 'Minha Loja',
    whatsapp_number TEXT NOT NULL DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '#E1306C',
    secondary_color TEXT NOT NULL DEFAULT '#833AB4',
    accent_color TEXT NOT NULL DEFAULT '#FCAF45',
    logo_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT '',
    size TEXT DEFAULT '',
    image_urls TEXT[] DEFAULT '{}',
    purchase_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    purchase_freight NUMERIC(10,2) NOT NULL DEFAULT 0,
    sale_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    sale_freight NUMERIC(10,2) NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    purchase_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    purchase_freight NUMERIC(10,2) NOT NULL DEFAULT 0,
    sale_markup NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_gifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    gift_id UUID NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
    quantity_per_sale INTEGER NOT NULL DEFAULT 1,
    UNIQUE(product_id, gift_id)
);

CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
    applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'selected')),
    product_ids UUID[] DEFAULT '{}',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO store_settings (store_name, whatsapp_number)
SELECT 'Minha Loja', ''
WHERE NOT EXISTS (SELECT 1 FROM store_settings LIMIT 1);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_settings_public_read" ON store_settings
    FOR SELECT USING (true);

CREATE POLICY "store_settings_auth_write" ON store_settings
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "products_public_read" ON products
    FOR SELECT USING (active = true);

CREATE POLICY "products_auth_all" ON products
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "gifts_public_read" ON gifts
    FOR SELECT USING (true);

CREATE POLICY "gifts_auth_all" ON gifts
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "product_gifts_public_read" ON product_gifts
    FOR SELECT USING (true);

CREATE POLICY "product_gifts_auth_all" ON product_gifts
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "promotions_public_read" ON promotions
    FOR SELECT USING (
        active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
    );

CREATE POLICY "promotions_auth_all" ON promotions
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(active);
CREATE INDEX IF NOT EXISTS idx_product_gifts_product ON product_gifts(product_id);
