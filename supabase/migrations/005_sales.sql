-- 005_sales.sql
-- Vendas, brindes da venda e função atômica de registro

CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT DEFAULT '',
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    product_size TEXT DEFAULT '',
    preco_catalogo NUMERIC(10,2) NOT NULL DEFAULT 0,
    desconto NUMERIC(10,2) NOT NULL DEFAULT 0,
    sale_freight NUMERIC(10,2) NOT NULL DEFAULT 0,
    preco_final NUMERIC(10,2) NOT NULL DEFAULT 0,
    promotion_id UUID,
    promotion_name TEXT,
    lucro NUMERIC(10,2) NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_gifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    gift_id UUID REFERENCES gifts(id) ON DELETE SET NULL,
    gift_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_gifts_sale ON sale_gifts(sale_id);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_auth_all ON sales
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY sale_gifts_auth_all ON sale_gifts
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Registra venda e decrementa estoque (produto + brindes) de forma atômica
CREATE OR REPLACE FUNCTION register_sale(
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_product_id UUID,
    p_product_name TEXT,
    p_product_size TEXT,
    p_preco_catalogo NUMERIC,
    p_desconto NUMERIC,
    p_sale_freight NUMERIC,
    p_preco_final NUMERIC,
    p_promotion_id UUID,
    p_promotion_name TEXT,
    p_lucro NUMERIC,
    p_notes TEXT,
    p_gifts JSONB DEFAULT '[]'::JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale_id UUID;
    v_product_stock INTEGER;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_name TEXT;
    v_qty INTEGER;
    v_gift_stock INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    SELECT stock INTO v_product_stock
    FROM products WHERE id = p_product_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado';
    END IF;

    IF v_product_stock < 1 THEN
        RAISE EXCEPTION 'Estoque do produto insuficiente';
    END IF;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);

        SELECT stock INTO v_gift_stock
        FROM gifts WHERE id = v_gift_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Brinde não encontrado';
        END IF;

        IF v_gift_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque do brinde insuficiente';
        END IF;
    END LOOP;

    INSERT INTO sales (
        customer_name, customer_phone, product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes
    ) VALUES (
        p_customer_name, p_customer_phone, p_product_id, p_product_name, p_product_size,
        p_preco_catalogo, p_desconto, p_sale_freight, p_preco_final,
        p_promotion_id, p_promotion_name, p_lucro, p_notes
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_name := v_gift->>'gift_name';
        v_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);

        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_qty);

        UPDATE gifts SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    UPDATE products SET stock = stock - 1, updated_at = NOW()
    WHERE id = p_product_id;

    RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION register_sale TO authenticated;
