-- 018_fix_create_checkout_uuid.sql
-- Substitui uuid_generate_v4() por gen_random_uuid() na função já existente.

CREATE OR REPLACE FUNCTION create_checkout_order(
    p_customer_id UUID,
    p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer customers%ROWTYPE;
    v_order_id UUID;
    v_tracking UUID;
    v_total NUMERIC(10,2) := 0;
    v_item JSONB;
    v_email TEXT;
BEGIN
    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cliente não informado';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) < 1 THEN
        RAISE EXCEPTION 'Pedido sem itens';
    END IF;

    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado';
    END IF;

    v_email := lower(trim(COALESCE(v_customer.email, '')));
    IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Cadastre um e-mail válido em Minha conta';
    END IF;

    v_tracking := gen_random_uuid();

    INSERT INTO orders (
        customer_id, customer_name, customer_phone, customer_cpf, customer_email,
        status, total_amount, tracking_token
    ) VALUES (
        v_customer.id, v_customer.name, v_customer.phone, v_customer.cpf, v_email,
        'pending_payment', 0, v_tracking
    ) RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO order_items (
            order_id, product_id, product_name, product_size, quantity,
            preco_catalogo, desconto, sale_freight, preco_final_line, lucro_line,
            promotion_id, promotion_name, gifts_snapshot
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            COALESCE(v_item->>'product_name', ''),
            COALESCE(v_item->>'product_size', 'M'),
            GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1),
            COALESCE((v_item->>'preco_catalogo')::NUMERIC, 0),
            COALESCE((v_item->>'desconto')::NUMERIC, 0),
            COALESCE((v_item->>'sale_freight')::NUMERIC, 0),
            COALESCE((v_item->>'preco_final_line')::NUMERIC, 0),
            COALESCE((v_item->>'lucro_line')::NUMERIC, 0),
            NULLIF(v_item->>'promotion_id', '')::UUID,
            NULLIF(v_item->>'promotion_name', ''),
            COALESCE(v_item->'gifts_snapshot', '[]'::JSONB)
        );
        v_total := v_total + COALESCE((v_item->>'preco_final_line')::NUMERIC, 0);
    END LOOP;

    UPDATE orders SET total_amount = v_total WHERE id = v_order_id;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'tracking_token', v_tracking,
        'total_amount', v_total
    );
END;
$$;

GRANT EXECUTE ON FUNCTION create_checkout_order(UUID, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
