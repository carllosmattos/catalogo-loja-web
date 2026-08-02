-- 024_pix_orders.sql
-- PIX com expiração (15 min), sync de status e pedidos expirados.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS qr_code_base64 TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_orders_expires_pending
    ON orders (expires_at)
    WHERE status = 'pending_payment';

-- Cancela pedidos PIX expirados
CREATE OR REPLACE FUNCTION expire_stale_orders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
    v_row RECORD;
BEGIN
    FOR v_row IN
        SELECT id FROM orders
        WHERE status = 'pending_payment'
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
        FOR UPDATE
    LOOP
        UPDATE orders
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
        WHERE id = v_row.id;

        UPDATE payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE order_id = v_row.id AND status = 'pending';

        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_stale_orders() TO anon, authenticated, service_role;

-- Valida estoque disponível (sem reserva — ver 026)
CREATE OR REPLACE FUNCTION _check_order_items_stock(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_item JSONB;
    v_pid UUID;
    v_size TEXT;
    v_qty INTEGER;
    v_stock INTEGER;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_qty INTEGER;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::UUID;
        v_qty := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
        v_size := UPPER(TRIM(COALESCE(NULLIF(v_item->>'product_size', ''), 'M')));
        IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
            v_size := 'M';
        END IF;

        IF EXISTS (
            SELECT 1 FROM product_sizes WHERE product_id = v_pid AND size = v_size
        ) THEN
            SELECT stock INTO v_stock
            FROM product_sizes WHERE product_id = v_pid AND size = v_size;
            IF COALESCE(v_stock, 0) < v_qty THEN
                RAISE EXCEPTION 'Estoque insuficiente para %', COALESCE(v_item->>'product_name', 'produto');
            END IF;
        ELSIF v_pid IS NOT NULL THEN
            SELECT stock INTO v_stock FROM products WHERE id = v_pid;
            IF COALESCE(v_stock, 0) < v_qty THEN
                RAISE EXCEPTION 'Estoque insuficiente para %', COALESCE(v_item->>'product_name', 'produto');
            END IF;
        END IF;

        FOR v_gift IN SELECT * FROM jsonb_array_elements(
            COALESCE(v_item->'gifts_snapshot', '[]'::JSONB)
        )
        LOOP
            v_gift_id := (v_gift->>'gift_id')::UUID;
            v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
            SELECT stock INTO v_stock FROM gifts WHERE id = v_gift_id;
            IF COALESCE(v_stock, 0) < v_gift_qty THEN
                RAISE EXCEPTION 'Estoque de brinde insuficiente';
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

-- Aplica status vindo do Mercado Pago (catálogo)
CREATE OR REPLACE FUNCTION apply_payment_status_public(
    p_order_id UUID,
    p_customer_id UUID,
    p_provider_payment_id TEXT,
    p_status TEXT,
    p_amount NUMERIC,
    p_pix_copy_paste TEXT DEFAULT '',
    p_raw JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_payment_id UUID;
    v_norm TEXT;
    v_qr TEXT;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Pedido não pertence ao cliente';
    END IF;

    v_norm := lower(trim(COALESCE(p_status, 'pending')));
    IF v_norm NOT IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process') THEN
        v_norm := 'pending';
    END IF;

    v_qr := COALESCE(p_raw->'point_of_interaction'->'transaction_data'->>'qr_code_base64', '');

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND provider_payment_id = p_provider_payment_id
    LIMIT 1;

    IF FOUND THEN
        UPDATE payments SET
            status = v_norm,
            amount = p_amount,
            pix_copy_paste = COALESCE(NULLIF(p_pix_copy_paste, ''), pix_copy_paste),
            qr_code_base64 = COALESCE(NULLIF(v_qr, ''), qr_code_base64),
            raw_payload = p_raw,
            paid_at = CASE WHEN v_norm = 'approved' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
        WHERE id = v_payment_id;
    ELSE
        INSERT INTO payments (
            order_id, provider_payment_id, status, amount,
            pix_copy_paste, qr_code_base64, raw_payload, paid_at
        ) VALUES (
            p_order_id, p_provider_payment_id, v_norm, p_amount,
            COALESCE(p_pix_copy_paste, ''), COALESCE(v_qr, ''), p_raw,
            CASE WHEN v_norm = 'approved' THEN NOW() ELSE NULL END
        ) RETURNING id INTO v_payment_id;
    END IF;

    IF v_norm = 'approved' AND v_order.status = 'pending_payment' THEN
        RETURN fulfill_paid_order(p_order_id, v_payment_id, p_provider_payment_id);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_id', v_payment_id,
        'status', v_norm
    );
END;
$$;

GRANT EXECUTE ON FUNCTION apply_payment_status_public(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB)
    TO anon, authenticated;

-- Aplica status (admin)
CREATE OR REPLACE FUNCTION apply_payment_status_admin(
    p_order_id UUID,
    p_provider_payment_id TEXT,
    p_status TEXT,
    p_amount NUMERIC,
    p_pix_copy_paste TEXT DEFAULT '',
    p_raw JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_payment_id UUID;
    v_norm TEXT;
    v_qr TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;

    v_norm := lower(trim(COALESCE(p_status, 'pending')));
    IF v_norm NOT IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process') THEN
        v_norm := 'pending';
    END IF;

    v_qr := COALESCE(p_raw->'point_of_interaction'->'transaction_data'->>'qr_code_base64', '');

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND provider_payment_id = p_provider_payment_id
    LIMIT 1;

    IF FOUND THEN
        UPDATE payments SET
            status = v_norm,
            amount = p_amount,
            pix_copy_paste = COALESCE(NULLIF(p_pix_copy_paste, ''), pix_copy_paste),
            qr_code_base64 = COALESCE(NULLIF(v_qr, ''), qr_code_base64),
            raw_payload = p_raw,
            paid_at = CASE WHEN v_norm = 'approved' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
        WHERE id = v_payment_id;
    ELSE
        INSERT INTO payments (
            order_id, provider_payment_id, status, amount,
            pix_copy_paste, qr_code_base64, raw_payload, paid_at
        ) VALUES (
            p_order_id, p_provider_payment_id, v_norm, p_amount,
            COALESCE(p_pix_copy_paste, ''), COALESCE(v_qr, ''), p_raw,
            CASE WHEN v_norm = 'approved' THEN NOW() ELSE NULL END
        ) RETURNING id INTO v_payment_id;
    END IF;

    IF v_norm = 'approved' AND v_order.status = 'pending_payment' THEN
        RETURN fulfill_paid_order(p_order_id, v_payment_id, p_provider_payment_id);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_id', v_payment_id,
        'status', v_norm
    );
END;
$$;

GRANT EXECUTE ON FUNCTION apply_payment_status_admin(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB)
    TO authenticated;

-- Criar pedido com anti-duplicata, expiração e validação de estoque
CREATE OR REPLACE FUNCTION create_checkout_order(
    p_customer_id UUID,
    p_items JSONB,
    p_shipping_amount NUMERIC DEFAULT 0
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
        status, total_amount, tracking_token, expires_at, shipping_amount
    ) VALUES (
        v_customer.id, v_customer.name, v_customer.phone, v_customer.cpf, v_email,
        'pending_payment', 0, v_tracking, v_expires, v_shipping
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

    v_total := v_total + v_shipping;
    UPDATE orders SET total_amount = v_total WHERE id = v_order_id;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'tracking_token', v_tracking,
        'total_amount', v_total,
        'expires_at', v_expires
    );
END;
$$;

GRANT EXECUTE ON FUNCTION create_checkout_order(UUID, JSONB, NUMERIC) TO anon, authenticated;

-- Grava pagamento PIX com expiração
CREATE OR REPLACE FUNCTION attach_order_payment_public(
    p_order_id UUID,
    p_provider_payment_id TEXT,
    p_status TEXT,
    p_amount NUMERIC,
    p_pix_copy_paste TEXT DEFAULT '',
    p_raw JSONB DEFAULT '{}'::JSONB,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_payment_id UUID;
    v_norm_status TEXT;
    v_qr TEXT;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.status <> 'pending_payment' THEN
        RAISE EXCEPTION 'Pedido não está aguardando pagamento';
    END IF;

    v_norm_status := lower(trim(COALESCE(p_status, 'pending')));
    IF v_norm_status NOT IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process') THEN
        v_norm_status := 'pending';
    END IF;

    v_qr := COALESCE(p_raw->'point_of_interaction'->'transaction_data'->>'qr_code_base64', '');

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND provider_payment_id = p_provider_payment_id
    LIMIT 1;

    IF FOUND THEN
        UPDATE payments SET
            status = v_norm_status,
            amount = p_amount,
            pix_copy_paste = COALESCE(NULLIF(p_pix_copy_paste, ''), pix_copy_paste),
            qr_code_base64 = COALESCE(NULLIF(v_qr, ''), qr_code_base64),
            raw_payload = p_raw,
            expires_at = COALESCE(p_expires_at, expires_at),
            updated_at = NOW()
        WHERE id = v_payment_id;
    ELSE
        INSERT INTO payments (
            order_id, provider_payment_id, status, amount,
            pix_copy_paste, qr_code_base64, raw_payload, expires_at
        ) VALUES (
            p_order_id, p_provider_payment_id, v_norm_status, p_amount,
            COALESCE(p_pix_copy_paste, ''), COALESCE(v_qr, ''), p_raw, p_expires_at
        ) RETURNING id INTO v_payment_id;
    END IF;

    IF p_expires_at IS NOT NULL THEN
        UPDATE orders SET expires_at = p_expires_at WHERE id = p_order_id;
    END IF;

    RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION attach_order_payment_public(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB, TIMESTAMPTZ)
    TO anon, authenticated;
