-- 007_sale_quantity.sql
-- Quantidade de peças por venda

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- Nova assinatura com p_quantity
DROP FUNCTION IF EXISTS register_sale(
    TEXT, TEXT, UUID, TEXT, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC,
    UUID, TEXT, NUMERIC, TEXT, JSONB
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
    p_quantity INTEGER DEFAULT 1
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
        customer_name, customer_phone, product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity
    ) VALUES (
        p_customer_name, p_customer_phone, p_product_id, p_product_name, p_product_size,
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

CREATE OR REPLACE FUNCTION cancel_sale(p_sale_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale RECORD;
    v_gift RECORD;
    v_qty INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    SELECT * INTO v_sale
    FROM sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venda não encontrada';
    END IF;

    IF v_sale.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION 'Venda já cancelada';
    END IF;

    v_qty := GREATEST(COALESCE(v_sale.quantity, 1), 1);

    IF v_sale.product_id IS NOT NULL THEN
        UPDATE products
        SET stock = stock + v_qty, updated_at = NOW()
        WHERE id = v_sale.product_id;
    END IF;

    FOR v_gift IN
        SELECT gift_id, quantity
        FROM sale_gifts
        WHERE sale_id = p_sale_id AND gift_id IS NOT NULL
    LOOP
        UPDATE gifts
        SET stock = stock + v_gift.quantity, updated_at = NOW()
        WHERE id = v_gift.gift_id;
    END LOOP;

    UPDATE sales
    SET cancelled_at = NOW()
    WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_sale TO authenticated;
