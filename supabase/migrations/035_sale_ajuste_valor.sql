-- 035_sale_ajuste_valor.sql
-- Ajuste (+/−) na venda para refletir frete real vs cotado (impacta lucro)

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS ajuste_valor NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales.ajuste_valor IS
    'Custo/economia extra (ex. frete real). Positivo reduz lucro; negativo aumenta.';

DROP FUNCTION IF EXISTS register_sale(
    TEXT, TEXT, UUID, TEXT, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC,
    UUID, TEXT, NUMERIC, TEXT, JSONB, INTEGER, UUID, TEXT
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
    p_customer_cpf TEXT DEFAULT '',
    p_ajuste_valor NUMERIC DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale_id UUID;
    v_size TEXT;
    v_has_size_row BOOLEAN;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_name TEXT;
    v_gift_qty INTEGER;
    v_gift_stock INTEGER;
    v_qty INTEGER;
    v_custo_peca NUMERIC(10,2) := 0;
    v_custo_brindes NUMERIC(10,2) := 0;
    v_custo_gift NUMERIC(10,2) := 0;
    v_lucro NUMERIC(10,2) := 0;
    v_ajuste NUMERIC(10,2) := 0;
    v_purchase_price NUMERIC(10,2) := 0;
    v_purchase_freight NUMERIC(10,2) := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    v_qty := GREATEST(COALESCE(p_quantity, 1), 1);
    v_ajuste := COALESCE(p_ajuste_valor, 0);
    v_size := UPPER(TRIM(COALESCE(NULLIF(p_product_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    SELECT COALESCE(purchase_price, 0), COALESCE(purchase_freight, 0)
    INTO v_purchase_price, v_purchase_freight
    FROM products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado';
    END IF;
    v_custo_peca := (v_purchase_price + v_purchase_freight) * v_qty;

    SELECT EXISTS (
        SELECT 1 FROM product_sizes
        WHERE product_id = p_product_id AND size = v_size
    ) INTO v_has_size_row;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        SELECT stock,
               (COALESCE(purchase_price, 0) + COALESCE(purchase_freight, 0)) * v_gift_qty
        INTO v_gift_stock, v_custo_gift
        FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Brinde não encontrado';
        END IF;
        IF v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque do brinde insuficiente';
        END IF;
        v_custo_brindes := v_custo_brindes + COALESCE(v_custo_gift, 0);
    END LOOP;

    -- Lucro = receita − custos − ajuste (frete real mais caro = ajuste positivo)
    v_lucro := COALESCE(p_preco_final, 0) - v_custo_peca - v_custo_brindes - v_ajuste;

    INSERT INTO sales (
        customer_name, customer_phone, customer_id, customer_cpf,
        product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity,
        custo_peca, custo_brindes, ajuste_valor
    ) VALUES (
        p_customer_name, p_customer_phone, p_customer_id, p_customer_cpf,
        p_product_id, p_product_name, v_size,
        p_preco_catalogo, p_desconto, p_sale_freight, p_preco_final,
        p_promotion_id, p_promotion_name, v_lucro, p_notes, v_qty,
        v_custo_peca, v_custo_brindes, v_ajuste
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_name := COALESCE(v_gift->>'gift_name', 'Brinde');
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);
        UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    IF v_has_size_row THEN
        PERFORM adjust_product_stock(
            p_product_id, v_size, 'out_sale', v_qty,
            COALESCE(NULLIF(TRIM(p_notes), ''), 'Venda manual'),
            NULL, 'sale', v_sale_id, FALSE
        );
    ELSE
        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = p_product_id AND stock >= v_qty;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estoque do produto insuficiente';
        END IF;
    END IF;

    RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION register_sale(
    TEXT, TEXT, UUID, TEXT, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC,
    UUID, TEXT, NUMERIC, TEXT, JSONB, INTEGER, UUID, TEXT, NUMERIC
) TO authenticated;
