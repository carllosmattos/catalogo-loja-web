-- 032_shipping_discounts.sql
-- Promoções e cupons podem abater produto OU frete.

ALTER TABLE coupons
    ADD COLUMN IF NOT EXISTS discount_target TEXT NOT NULL DEFAULT 'product';

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS discount_target TEXT NOT NULL DEFAULT 'product';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'coupons_discount_target_check'
          AND conrelid = 'coupons'::regclass
    ) THEN
        ALTER TABLE coupons
            ADD CONSTRAINT coupons_discount_target_check
            CHECK (discount_target IN ('product', 'shipping'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'promotions_discount_target_check'
          AND conrelid = 'promotions'::regclass
    ) THEN
        ALTER TABLE promotions
            ADD CONSTRAINT promotions_discount_target_check
            CHECK (discount_target IN ('product', 'shipping'));
    END IF;
END $$;

-- Cupons já criados no padrão LM-FRETE-* passam a abater frete
UPDATE coupons
SET discount_target = 'shipping'
WHERE upper(code) LIKE 'LM-FRETE-%'
  AND COALESCE(discount_target, 'product') = 'product';

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS shipping_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Recria validate_coupon com frete
DROP FUNCTION IF EXISTS validate_coupon(TEXT, UUID, NUMERIC);
DROP FUNCTION IF EXISTS validate_coupon(TEXT, UUID, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION validate_coupon(
    p_code TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_subtotal NUMERIC DEFAULT 0,
    p_shipping NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_coupon_code(p_code);
    v_c coupons%ROWTYPE;
    v_discount NUMERIC;
    v_target TEXT;
    v_base NUMERIC;
BEGIN
    IF v_code = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Informe o código do cupom');
    END IF;

    SELECT * INTO v_c FROM coupons WHERE upper(code) = v_code LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom inválido');
    END IF;
    IF NOT v_c.active THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom inválido ou expirado');
    END IF;
    IF v_c.used_count >= v_c.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom esgotado');
    END IF;

    IF p_customer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM coupon_redemptions
        WHERE coupon_id = v_c.id AND customer_id = p_customer_id
        LIMIT 1
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Você já usou este cupom');
    END IF;

    v_target := COALESCE(NULLIF(v_c.discount_target, ''), 'product');
    IF v_target = 'shipping' THEN
        v_base := GREATEST(COALESCE(p_shipping, 0), 0);
        IF v_base <= 0 THEN
            RETURN jsonb_build_object(
                'ok', false,
                'error', 'Cupom de frete só vale com frete cobrado (entrega)'
            );
        END IF;
    ELSE
        v_target := 'product';
        v_base := GREATEST(COALESCE(p_subtotal, 0), 0);
    END IF;

    IF v_c.discount_type = 'percent' THEN
        v_discount := ROUND(v_base * (v_c.discount_value / 100.0), 2);
    ELSE
        v_discount := LEAST(v_c.discount_value, v_base);
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'coupon_id', v_c.id,
        'code', v_c.code,
        'title', v_c.title,
        'discount_type', v_c.discount_type,
        'discount_value', v_c.discount_value,
        'discount_amount', v_discount,
        'discount_target', v_target,
        'image_url', COALESCE(v_c.image_url, '')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_coupon(TEXT, UUID, NUMERIC, NUMERIC)
    TO anon, authenticated, service_role;

-- create_checkout_order: shipping_discount separado
DROP FUNCTION IF EXISTS create_checkout_order(UUID, JSONB, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS create_checkout_order(UUID, JSONB, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION create_checkout_order(
    p_customer_id UUID,
    p_items JSONB,
    p_shipping_amount NUMERIC DEFAULT 0,
    p_discount_amount NUMERIC DEFAULT 0,
    p_shipping_discount NUMERIC DEFAULT 0
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
    v_shipping NUMERIC(10,2);
    v_discount NUMERIC(10,2);
    v_ship_disc NUMERIC(10,2);
    v_item JSONB;
    v_email TEXT;
    v_expires TIMESTAMPTZ;
    v_active INTEGER;
BEGIN
    PERFORM expire_stale_orders();

    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cliente não informado';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) < 1 THEN
        RAISE EXCEPTION 'Pedido sem itens';
    END IF;

    v_shipping := GREATEST(COALESCE(p_shipping_amount, 0), 0);
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);
    v_ship_disc := GREATEST(COALESCE(p_shipping_discount, 0), 0);
    IF v_ship_disc > v_shipping THEN
        v_ship_disc := v_shipping;
    END IF;

    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado';
    END IF;

    v_email := lower(trim(COALESCE(v_customer.email, '')));
    IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Cadastre um e-mail válido em Minha conta';
    END IF;

    SELECT COUNT(*) INTO v_active
    FROM orders
    WHERE customer_id = p_customer_id
      AND status = 'pending_payment'
      AND (expires_at IS NULL OR expires_at > NOW());

    IF v_active > 0 THEN
        RAISE EXCEPTION 'Você já tem um pedido aguardando PIX. Conclua ou cancele em Minhas compras.';
    END IF;

    PERFORM _check_order_items_stock(p_items);

    v_tracking := gen_random_uuid();
    v_expires := NOW() + INTERVAL '15 minutes';

    INSERT INTO orders (
        customer_id, customer_name, customer_phone, customer_cpf, customer_email,
        status, total_amount, tracking_token, expires_at,
        shipping_amount, discount_amount, shipping_discount_amount
    ) VALUES (
        v_customer.id, v_customer.name, v_customer.phone, v_customer.cpf, v_email,
        'pending_payment', 0, v_tracking, v_expires,
        v_shipping, v_discount, v_ship_disc
    ) RETURNING id INTO v_order_id;

    PERFORM _reserve_order_items(v_order_id, p_items, v_expires);

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

    IF v_discount > v_total THEN
        v_discount := v_total;
    END IF;

    v_total := GREATEST(v_total - v_discount, 0) + GREATEST(v_shipping - v_ship_disc, 0);
    UPDATE orders
    SET
        total_amount = v_total,
        discount_amount = v_discount,
        shipping_discount_amount = v_ship_disc,
        shipping_amount = v_shipping
    WHERE id = v_order_id;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'tracking_token', v_tracking,
        'total_amount', v_total,
        'discount_amount', v_discount,
        'shipping_discount_amount', v_ship_disc,
        'expires_at', v_expires
    );
END;
$$;

GRANT EXECUTE ON FUNCTION create_checkout_order(UUID, JSONB, NUMERIC, NUMERIC, NUMERIC)
    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
