-- 026_stock_reservation.sql
-- Reserva temporária de estoque alinhada à expiração do PIX.

CREATE TABLE IF NOT EXISTS stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    product_size TEXT NOT NULL DEFAULT 'M',
    gift_id UUID REFERENCES gifts(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT stock_reservations_target_chk CHECK (
        (product_id IS NOT NULL AND gift_id IS NULL)
        OR (product_id IS NULL AND gift_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_expires ON stock_reservations (expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_product
    ON stock_reservations (product_id, product_size) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_reservations_gift
    ON stock_reservations (gift_id) WHERE gift_id IS NOT NULL;

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_reservations_auth_all ON stock_reservations;
CREATE POLICY stock_reservations_auth_all ON stock_reservations
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Estoque efetivo = físico - reservas ativas de outros pedidos
CREATE OR REPLACE FUNCTION _available_product_stock(
    p_product_id UUID,
    p_size TEXT,
    p_exclude_order_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_stock INTEGER := 0;
    v_reserved INTEGER := 0;
    v_size TEXT;
BEGIN
    v_size := UPPER(TRIM(COALESCE(NULLIF(p_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    IF EXISTS (SELECT 1 FROM product_sizes WHERE product_id = p_product_id AND size = v_size) THEN
        SELECT stock INTO v_stock FROM product_sizes
        WHERE product_id = p_product_id AND size = v_size;
    ELSE
        SELECT stock INTO v_stock FROM products WHERE id = p_product_id;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
    FROM stock_reservations
    WHERE product_id = p_product_id
      AND product_size = v_size
      AND expires_at > NOW()
      AND (p_exclude_order_id IS NULL OR order_id IS DISTINCT FROM p_exclude_order_id);

    RETURN GREATEST(COALESCE(v_stock, 0) - COALESCE(v_reserved, 0), 0);
END;
$$;

CREATE OR REPLACE FUNCTION _available_gift_stock(
    p_gift_id UUID,
    p_exclude_order_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_stock INTEGER;
    v_reserved INTEGER;
BEGIN
    SELECT stock INTO v_stock FROM gifts WHERE id = p_gift_id;
    SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
    FROM stock_reservations
    WHERE gift_id = p_gift_id
      AND expires_at > NOW()
      AND (p_exclude_order_id IS NULL OR order_id IS DISTINCT FROM p_exclude_order_id);
    RETURN GREATEST(COALESCE(v_stock, 0) - COALESCE(v_reserved, 0), 0);
END;
$$;

CREATE OR REPLACE FUNCTION _release_order_reservations(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM stock_reservations WHERE order_id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION _reserve_order_items(
    p_order_id UUID,
    p_items JSONB,
    p_expires_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_item JSONB;
    v_pid UUID;
    v_size TEXT;
    v_qty INTEGER;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_qty INTEGER;
    v_avail INTEGER;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::UUID;
        v_qty := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
        v_size := UPPER(TRIM(COALESCE(NULLIF(v_item->>'product_size', ''), 'M')));
        IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
            v_size := 'M';
        END IF;

        v_avail := _available_product_stock(v_pid, v_size, p_order_id);
        IF v_avail < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', COALESCE(v_item->>'product_name', 'produto');
        END IF;

        INSERT INTO stock_reservations (
            order_id, product_id, product_size, quantity, expires_at
        ) VALUES (p_order_id, v_pid, v_size, v_qty, p_expires_at);

        FOR v_gift IN SELECT * FROM jsonb_array_elements(
            COALESCE(v_item->'gifts_snapshot', '[]'::JSONB)
        )
        LOOP
            v_gift_id := (v_gift->>'gift_id')::UUID;
            v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
            v_avail := _available_gift_stock(v_gift_id, p_order_id);
            IF v_avail < v_gift_qty THEN
                RAISE EXCEPTION 'Estoque de brinde insuficiente';
            END IF;
            INSERT INTO stock_reservations (
                order_id, gift_id, product_size, quantity, expires_at
            ) VALUES (p_order_id, v_gift_id, 'M', v_gift_qty, p_expires_at);
        END LOOP;
    END LOOP;
END;
$$;

-- Atualiza validação de estoque para considerar reservas
CREATE OR REPLACE FUNCTION _check_order_items_stock(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_item JSONB;
    v_pid UUID;
    v_size TEXT;
    v_qty INTEGER;
    v_avail INTEGER;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_qty INTEGER;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::UUID;
        v_qty := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
        v_size := UPPER(TRIM(COALESCE(NULLIF(v_item->>'product_size', ''), 'M')));
        v_avail := _available_product_stock(v_pid, v_size, NULL);
        IF v_avail < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', COALESCE(v_item->>'product_name', 'produto');
        END IF;

        FOR v_gift IN SELECT * FROM jsonb_array_elements(
            COALESCE(v_item->'gifts_snapshot', '[]'::JSONB)
        )
        LOOP
            v_gift_id := (v_gift->>'gift_id')::UUID;
            v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
            v_avail := _available_gift_stock(v_gift_id, NULL);
            IF v_avail < v_gift_qty THEN
                RAISE EXCEPTION 'Estoque de brinde insuficiente';
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

-- Expira pedidos e libera reservas
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
    DELETE FROM stock_reservations WHERE expires_at < NOW();

    FOR v_row IN
        SELECT id FROM orders
        WHERE status = 'pending_payment'
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
        FOR UPDATE
    LOOP
        PERFORM _release_order_reservations(v_row.id);
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

-- create_checkout_order com reserva
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

-- Libera reserva ao cancelar pedido não pago
CREATE OR REPLACE FUNCTION cancel_unpaid_order(p_order_id UUID, p_customer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Pedido não pertence ao cliente';
    END IF;
    IF v_order.status <> 'pending_payment' THEN
        RAISE EXCEPTION 'Só é possível cancelar pedidos aguardando pagamento';
    END IF;

    PERFORM _release_order_reservations(p_order_id);

    UPDATE orders
    SET status = 'cancelled', cancelled_at = NOW()
    WHERE id = p_order_id;

    UPDATE payments
    SET status = 'cancelled', updated_at = NOW()
    WHERE order_id = p_order_id AND status = 'pending';
END;
$$;

-- Ao pagar, remove reservas (estoque já baixa em _fulfill_order_item)
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
        PERFORM _release_order_reservations(p_order_id);
        RETURN jsonb_build_object('already_fulfilled', true, 'order_id', p_order_id);
    END IF;

    IF EXISTS (SELECT 1 FROM sales WHERE order_id = p_order_id LIMIT 1) THEN
        PERFORM _release_order_reservations(p_order_id);
        UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW())
        WHERE id = p_order_id;
        RETURN jsonb_build_object('already_fulfilled', true, 'order_id', p_order_id);
    END IF;

    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id
    LOOP
        v_sale_id := _fulfill_order_item(v_order, v_item, p_payment_id);
        v_sale_ids := array_append(v_sale_ids, v_sale_id);
    END LOOP;

    PERFORM _release_order_reservations(p_order_id);

    UPDATE orders
    SET status = 'paid', paid_at = NOW(), external_reference = COALESCE(p_provider_payment_id, external_reference)
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'sale_ids', to_jsonb(v_sale_ids)
    );
END;
$$;
