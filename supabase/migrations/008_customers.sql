    -- 008_customers.sql
    -- Cadastro de clientes (CPF) e vínculo com vendas

    CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        cpf TEXT NOT NULL UNIQUE,
        points INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_customers_cpf ON customers(cpf);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

    ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

    ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS customer_cpf TEXT DEFAULT '';

    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

    ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

    CREATE POLICY customers_auth_all ON customers
        FOR ALL USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');

    DROP FUNCTION IF EXISTS register_sale(
        TEXT, TEXT, UUID, TEXT, TEXT,
        NUMERIC, NUMERIC, NUMERIC, NUMERIC,
        UUID, TEXT, NUMERIC, TEXT, JSONB, INTEGER
    );

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
        p_gifts JSONB DEFAULT '[]'::JSONB,
        p_quantity INTEGER DEFAULT 1,
        p_customer_id UUID DEFAULT NULL,
        p_customer_cpf TEXT DEFAULT ''
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
        v_gift_qty INTEGER;
        v_gift_stock INTEGER;
        v_qty INTEGER;
    BEGIN
        IF auth.role() IS DISTINCT FROM 'authenticated' THEN
            RAISE EXCEPTION 'Não autorizado';
        END IF;

        v_qty := GREATEST(COALESCE(p_quantity, 1), 1);

        SELECT stock INTO v_product_stock
        FROM products WHERE id = p_product_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto não encontrado';
        END IF;

        IF v_product_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque do produto insuficiente';
        END IF;

        FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
        LOOP
            v_gift_id := (v_gift->>'gift_id')::UUID;
            v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);

            SELECT stock INTO v_gift_stock
            FROM gifts WHERE id = v_gift_id FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Brinde não encontrado';
            END IF;

            IF v_gift_stock < v_gift_qty THEN
                RAISE EXCEPTION 'Estoque do brinde insuficiente';
            END IF;
        END LOOP;

        INSERT INTO sales (
            customer_name, customer_phone, customer_id, customer_cpf,
            product_id, product_name, product_size,
            preco_catalogo, desconto, sale_freight, preco_final,
            promotion_id, promotion_name, lucro, notes, quantity
        ) VALUES (
            p_customer_name, p_customer_phone, p_customer_id, p_customer_cpf,
            p_product_id, p_product_name, p_product_size,
            p_preco_catalogo, p_desconto, p_sale_freight, p_preco_final,
            p_promotion_id, p_promotion_name, p_lucro, p_notes, v_qty
        ) RETURNING id INTO v_sale_id;

        FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
        LOOP
            v_gift_id := (v_gift->>'gift_id')::UUID;
            v_gift_name := v_gift->>'gift_name';
            v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);

            INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
            VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);

            UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
            WHERE id = v_gift_id;
        END LOOP;

        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = p_product_id;

        RETURN v_sale_id;
    END;
    $$;

    GRANT EXECUTE ON FUNCTION register_sale TO authenticated;
