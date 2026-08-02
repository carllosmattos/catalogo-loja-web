-- 033_repair_fulfill_order_item.sql
-- Repara: function _fulfill_order_item(orders, order_items, uuid) does not exist
-- Causa comum: função com %ROWTYPE sumiu/quebrou após ALTER TABLE.
-- Nova assinatura usa UUIDs (mais estável).

-- Remove assinaturas antigas (ROWTYPE e UUID)
DROP FUNCTION IF EXISTS _fulfill_order_item(orders, order_items, uuid);
DROP FUNCTION IF EXISTS _fulfill_order_item(uuid, uuid, uuid);

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
        IF v_gift_id IS NULL THEN
            CONTINUE;
        END IF;
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        SELECT stock INTO v_gift_stock FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND OR v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque de brinde insuficiente';
        END IF;
    END LOOP;

    INSERT INTO sales (
        customer_name, customer_phone, customer_id, customer_cpf,
        product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity,
        order_id, payment_id
    ) VALUES (
        v_order.customer_name, v_order.customer_phone, v_order.customer_id,
        v_order.customer_cpf,
        v_item.product_id, v_item.product_name, v_size,
        v_item.preco_catalogo, v_item.desconto, v_item.sale_freight,
        v_item.preco_final_line,
        v_item.promotion_id, v_item.promotion_name, v_item.lucro_line,
        COALESCE(v_order.notes, ''), v_qty,
        v_order.id, p_payment_id
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        BEGIN
            v_gift_id := (v_gift->>'gift_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        IF v_gift_id IS NULL THEN
            CONTINUE;
        END IF;
        v_gift_name := COALESCE(v_gift->>'gift_name', 'Brinde');
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);
        UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    IF v_has_size_row THEN
        UPDATE product_sizes SET stock = stock - v_qty
        WHERE product_id = v_item.product_id AND size = v_size;
    ELSIF v_item.product_id IS NOT NULL THEN
        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = v_item.product_id;
    END IF;

    RETURN v_sale_id;
END;
$$;

-- Recria fulfill_paid_order chamando a nova assinatura
CREATE OR REPLACE FUNCTION fulfill_paid_order(
    p_order_id UUID,
    p_payment_id UUID,
    p_provider_payment_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_item order_items%ROWTYPE;
    v_sale_ids UUID[] := '{}';
    v_sale_id UUID;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;

    IF v_order.status = 'paid' THEN
        BEGIN
            PERFORM _release_order_reservations(p_order_id);
        EXCEPTION WHEN undefined_function THEN
            NULL;
        END;
        RETURN jsonb_build_object('already_fulfilled', true, 'order_id', p_order_id);
    END IF;

    IF EXISTS (SELECT 1 FROM sales WHERE order_id = p_order_id LIMIT 1) THEN
        BEGIN
            PERFORM _release_order_reservations(p_order_id);
        EXCEPTION WHEN undefined_function THEN
            NULL;
        END;
        UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW())
        WHERE id = p_order_id;
        RETURN jsonb_build_object('already_fulfilled', true, 'order_id', p_order_id);
    END IF;

    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id
    LOOP
        v_sale_id := _fulfill_order_item(p_order_id, v_item.id, p_payment_id);
        v_sale_ids := array_append(v_sale_ids, v_sale_id);
    END LOOP;

    BEGIN
        PERFORM _release_order_reservations(p_order_id);
    EXCEPTION WHEN undefined_function THEN
        NULL;
    END;

    UPDATE orders
    SET status = 'paid',
        paid_at = NOW(),
        external_reference = COALESCE(p_provider_payment_id, external_reference)
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'sale_ids', to_jsonb(v_sale_ids)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION fulfill_paid_order(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fulfill_paid_order(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fulfill_paid_order(UUID, UUID, TEXT) TO anon;
