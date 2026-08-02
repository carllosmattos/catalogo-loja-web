-- 041_gift_unit_cost_lot_freight.sql
-- Custo unitário do brinde = preço/un + (frete do lote / qtd do lote)

ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS purchase_lot_qty INTEGER NOT NULL DEFAULT 1
    CHECK (purchase_lot_qty >= 1);

COMMENT ON COLUMN gifts.purchase_price IS
    'Preço de compra por unidade do brinde.';
COMMENT ON COLUMN gifts.purchase_freight IS
    'Frete total do lote na compra (rateado por purchase_lot_qty).';
COMMENT ON COLUMN gifts.purchase_lot_qty IS
    'Quantidade de unidades do lote à qual o frete se aplica.';

CREATE OR REPLACE FUNCTION gift_unit_cost(
    p_purchase_price NUMERIC,
    p_purchase_freight NUMERIC,
    p_lot_qty INTEGER DEFAULT 1
) RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ROUND(
        COALESCE(p_purchase_price, 0)
        + COALESCE(p_purchase_freight, 0)
          / GREATEST(COALESCE(p_lot_qty, 1), 1),
        2
    );
$$;

GRANT EXECUTE ON FUNCTION gift_unit_cost(NUMERIC, NUMERIC, INTEGER)
    TO anon, authenticated, service_role;

-- register_sale: custo de brinde rateado
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
    v_gift_price NUMERIC(10,2) := 0;
    v_gift_freight NUMERIC(10,2) := 0;
    v_gift_lot INTEGER := 1;
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
               COALESCE(purchase_price, 0),
               COALESCE(purchase_freight, 0),
               GREATEST(COALESCE(purchase_lot_qty, 1), 1)
        INTO v_gift_stock, v_gift_price, v_gift_freight, v_gift_lot
        FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Brinde não encontrado';
        END IF;
        IF v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque do brinde insuficiente';
        END IF;
        v_custo_gift := gift_unit_cost(v_gift_price, v_gift_freight, v_gift_lot)
            * v_gift_qty;
        v_custo_brindes := v_custo_brindes + COALESCE(v_custo_gift, 0);
    END LOOP;

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

-- fulfill online: mesmo rateio
CREATE OR REPLACE FUNCTION _fulfill_order_item(
    p_order_id UUID,
    p_item_id UUID,
    p_payment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_item order_items%ROWTYPE;
    v_sale_id UUID;
    v_size TEXT;
    v_has_size_row BOOLEAN;
    v_size_stock INTEGER;
    v_product_stock INTEGER;
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
    v_gift_price NUMERIC(10,2) := 0;
    v_gift_freight NUMERIC(10,2) := 0;
    v_gift_lot INTEGER := 1;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;

    SELECT * INTO v_item FROM order_items WHERE id = p_item_id AND order_id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item do pedido não encontrado';
    END IF;

    v_qty := GREATEST(COALESCE(v_item.quantity, 1), 1);
    v_size := UPPER(TRIM(COALESCE(NULLIF(v_item.product_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    IF v_item.product_id IS NOT NULL THEN
        SELECT COALESCE(purchase_price, 0), COALESCE(purchase_freight, 0)
        INTO v_purchase_price, v_purchase_freight
        FROM products WHERE id = v_item.product_id;
        v_custo_peca := (v_purchase_price + v_purchase_freight) * v_qty;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM product_sizes
        WHERE product_id = v_item.product_id AND size = v_size
    ) INTO v_has_size_row;

    IF v_has_size_row THEN
        SELECT stock INTO v_size_stock
        FROM product_sizes
        WHERE product_id = v_item.product_id AND size = v_size
        FOR UPDATE;
        IF v_size_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', v_item.product_name;
        END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_product_stock
        FROM products WHERE id = v_item.product_id FOR UPDATE;
        IF NOT FOUND OR v_product_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', v_item.product_name;
        END IF;
    END IF;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        BEGIN
            v_gift_id := (v_gift->>'gift_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        IF v_gift_id IS NULL THEN CONTINUE; END IF;
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        SELECT stock,
               COALESCE(purchase_price, 0),
               COALESCE(purchase_freight, 0),
               GREATEST(COALESCE(purchase_lot_qty, 1), 1)
        INTO v_gift_stock, v_gift_price, v_gift_freight, v_gift_lot
        FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND OR v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque de brinde insuficiente';
        END IF;
        v_custo_gift := gift_unit_cost(v_gift_price, v_gift_freight, v_gift_lot)
            * v_gift_qty;
        v_custo_brindes := v_custo_brindes + COALESCE(v_custo_gift, 0);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM sales WHERE order_id = p_order_id LIMIT 1) THEN
        v_ajuste := COALESCE(v_order.frete_absorvido, 0);
    END IF;

    v_lucro := COALESCE(v_item.preco_final_line, 0)
        - v_custo_peca - v_custo_brindes - v_ajuste;

    INSERT INTO sales (
        customer_name, customer_phone, customer_id, customer_cpf,
        product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity,
        order_id, payment_id, custo_peca, custo_brindes, ajuste_valor
    ) VALUES (
        v_order.customer_name, v_order.customer_phone, v_order.customer_id,
        v_order.customer_cpf,
        v_item.product_id, v_item.product_name, v_size,
        v_item.preco_catalogo, v_item.desconto, v_item.sale_freight,
        v_item.preco_final_line,
        v_item.promotion_id, v_item.promotion_name, v_lucro,
        COALESCE(v_order.notes, ''), v_qty,
        v_order.id, p_payment_id, v_custo_peca, v_custo_brindes, v_ajuste
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        BEGIN
            v_gift_id := (v_gift->>'gift_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        IF v_gift_id IS NULL THEN CONTINUE; END IF;
        v_gift_name := COALESCE(v_gift->>'gift_name', 'Brinde');
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);
        UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    IF v_has_size_row AND v_item.product_id IS NOT NULL THEN
        PERFORM adjust_product_stock(
            v_item.product_id, v_size, 'out_sale', v_qty,
            'Venda online', NULL, 'sale', v_sale_id, FALSE
        );
    ELSIF v_item.product_id IS NOT NULL THEN
        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = v_item.product_id;
        INSERT INTO stock_movements (
            product_id, product_size, movement_type, quantity,
            stock_before, stock_after, reason, reference_type, reference_id
        ) VALUES (
            v_item.product_id, v_size, 'out_sale', -v_qty,
            COALESCE(v_product_stock, 0), COALESCE(v_product_stock, 0) - v_qty,
            'Venda online (estoque legado)', 'sale', v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
