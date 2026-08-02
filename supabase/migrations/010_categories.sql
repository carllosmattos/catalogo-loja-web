-- 010_categories.sql
-- Categorias de produtos para filtro no catálogo

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(active);

INSERT INTO categories (name, sort_order) VALUES
    ('Vestidos', 1),
    ('Blusas', 2),
    ('Calças', 3),
    ('Saias', 4),
    ('Conjuntos', 5),
    ('Casacos', 6),
    ('Acessórios', 7),
    ('Outros', 99)
ON CONFLICT (name) DO NOTHING;

-- Vincula produtos existentes pelo texto de categoria
UPDATE products p
SET category_id = c.id
FROM categories c
WHERE p.category_id IS NULL
  AND TRIM(COALESCE(p.category, '')) <> ''
  AND LOWER(TRIM(p.category)) = LOWER(TRIM(c.name));

UPDATE products p
SET category_id = c.id,
    category = c.name
FROM categories c
WHERE p.category_id IS NULL
  AND c.name = 'Outros';

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_public_read" ON categories;
CREATE POLICY "categories_public_read" ON categories
    FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "categories_auth_all" ON categories;
CREATE POLICY "categories_auth_all" ON categories
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
