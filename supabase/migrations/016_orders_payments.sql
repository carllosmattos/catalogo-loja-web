-- 016_orders_payments.sql
-- Pedidos, pagamentos PIX (Mercado Pago) e reembolsos

-- ── Pedidos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT DEFAULT '',
    customer_cpf TEXT DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN (
            'pending_payment', 'paid', 'cancelled',
            'refund_requested', 'refunded'
        )),
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    gateway TEXT DEFAULT 'mercado_pago',
    external_reference TEXT,
    mp_preference_id TEXT,
    tracking_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_token);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    product_size TEXT DEFAULT 'M',
    quantity INTEGER NOT NULL DEFAULT 1,
    preco_catalogo NUMERIC(10,2) NOT NULL DEFAULT 0,
    desconto NUMERIC(10,2) NOT NULL DEFAULT 0,
    sale_freight NUMERIC(10,2) NOT NULL DEFAULT 0,
    preco_final_line NUMERIC(10,2) NOT NULL DEFAULT 0,
    lucro_line NUMERIC(10,2) NOT NULL DEFAULT 0,
    promotion_id UUID,
    promotion_name TEXT,
    gifts_snapshot JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ── Pagamentos ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'mercado_pago',
    provider_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process'
        )),
    method TEXT DEFAULT 'pix',
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    pix_copy_paste TEXT DEFAULT '',
    paid_at TIMESTAMPTZ,
    raw_payload JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_id
    ON payments(provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- ── Reembolsos ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'processed')),
    reason TEXT DEFAULT '',
    admin_notes TEXT DEFAULT '',
    provider_refund_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);

-- ── Vendas vinculadas ───────────────────────────────────────
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_order ON sales(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment ON sales(payment_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_auth_all ON orders;
CREATE POLICY orders_auth_all ON orders
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS order_items_auth_all ON order_items;
CREATE POLICY order_items_auth_all ON order_items
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS payments_auth_all ON payments;
CREATE POLICY payments_auth_all ON payments
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS refund_requests_auth_all ON refund_requests;
CREATE POLICY refund_requests_auth_all ON refund_requests
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- ── Helper: registrar uma linha de venda (interno) ───────────
CREATE OR REPLACE FUNCTION _fulfill_order_item(
    p_order orders%ROWTYPE,
    p_item order_items%ROWTYPE,
    p_payment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    v_unit_final NUMERIC;
    v_unit_lucro NUMERIC;
BEGIN
    v_qty := GREATEST(COALESCE(p_item.quantity, 1), 1);
    v_size := UPPER(TRIM(COALESCE(NULLIF(p_item.product_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM product_sizes
        WHERE product_id = p_item.product_id AND size = v_size
    ) INTO v_has_size_row;

    IF v_has_size_row THEN
        SELECT stock INTO v_size_stock
        FROM product_sizes
        WHERE product_id = p_item.product_id AND size = v_size
        FOR UPDATE;
        IF v_size_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', p_item.product_name;
        END IF;
    ELSIF p_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_product_stock
        FROM products WHERE id = p_item.product_id FOR UPDATE;
        IF NOT FOUND OR v_product_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', p_item.product_name;
        END IF;
    END IF;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        SELECT stock INTO v_gift_stock FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND OR v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque de brinde insuficiente';
        END IF;
    END LOOP;

    v_unit_final := p_item.preco_final_line / v_qty;
    v_unit_lucro := p_item.lucro_line / v_qty;

    INSERT INTO sales (
        customer_name, customer_phone, customer_id, customer_cpf,
        product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity,
        order_id, payment_id
    ) VALUES (
        p_order.customer_name, p_order.customer_phone, p_order.customer_id,
        p_order.customer_cpf,
        p_item.product_id, p_item.product_name, v_size,
        p_item.preco_catalogo, p_item.desconto, p_item.sale_freight,
        p_item.preco_final_line,
        p_item.promotion_id, p_item.promotion_name, p_item.lucro_line,
        COALESCE(p_order.notes, ''), v_qty,
        p_order.id, p_payment_id
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_name := v_gift->>'gift_name';
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);
        UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    IF v_has_size_row THEN
        UPDATE product_sizes SET stock = stock - v_qty
        WHERE product_id = p_item.product_id AND size = v_size;
    ELSIF p_item.product_id IS NOT NULL THEN
        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = p_item.product_id;
    END IF;

    RETURN v_sale_id;
END;
$$;

-- ── Criar pedido (catálogo) ─────────────────────────────────
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

-- ── Confirmar pagamento e gerar vendas ──────────────────────
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
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;

    IF v_order.status = 'paid' THEN
        RETURN jsonb_build_object('already_fulfilled', true, 'order_id', p_order_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM sales WHERE order_id = p_order_id LIMIT 1
    ) THEN
        UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW())
        WHERE id = p_order_id;
        RETURN jsonb_build_object('already_fulfilled', true, 'order_id', p_order_id);
    END IF;

    FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id
    LOOP
        v_sale_id := _fulfill_order_item(v_order, v_item, p_payment_id);
        v_sale_ids := array_append(v_sale_ids, v_sale_id);
    END LOOP;

    UPDATE orders
    SET status = 'paid', paid_at = NOW(), external_reference = COALESCE(p_provider_payment_id, external_reference)
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'sale_ids', to_jsonb(v_sale_ids)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION fulfill_paid_order(UUID, UUID, TEXT) TO service_role;

-- ── Upsert pagamento (webhook) ──────────────────────────────
CREATE OR REPLACE FUNCTION upsert_order_payment(
    p_order_id UUID,
    p_provider_payment_id TEXT,
    p_status TEXT,
    p_amount NUMERIC,
    p_pix_copy_paste TEXT DEFAULT '',
    p_raw JSONB DEFAULT '{}'::JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id UUID;
    v_norm_status TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    v_norm_status := lower(trim(COALESCE(p_status, 'pending')));
    IF v_norm_status NOT IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process') THEN
        v_norm_status := 'pending';
    END IF;

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND provider_payment_id = p_provider_payment_id
    LIMIT 1;

    IF FOUND THEN
        UPDATE payments SET
            status = v_norm_status,
            amount = p_amount,
            pix_copy_paste = COALESCE(NULLIF(p_pix_copy_paste, ''), pix_copy_paste),
            raw_payload = p_raw,
            paid_at = CASE WHEN v_norm_status = 'approved' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
            updated_at = NOW()
        WHERE id = v_payment_id;
    ELSE
        INSERT INTO payments (
            order_id, provider_payment_id, status, amount, pix_copy_paste, raw_payload, paid_at
        ) VALUES (
            p_order_id, p_provider_payment_id, v_norm_status, p_amount,
            COALESCE(p_pix_copy_paste, ''),
            p_raw,
            CASE WHEN v_norm_status = 'approved' THEN NOW() ELSE NULL END
        ) RETURNING id INTO v_payment_id;
    END IF;

    RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_order_payment(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB) TO service_role;

-- Grava pagamento PIX ao iniciar checkout (catálogo anon)
CREATE OR REPLACE FUNCTION attach_order_payment_public(
    p_order_id UUID,
    p_provider_payment_id TEXT,
    p_status TEXT,
    p_amount NUMERIC,
    p_pix_copy_paste TEXT DEFAULT '',
    p_raw JSONB DEFAULT '{}'::JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_payment_id UUID;
    v_norm_status TEXT;
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

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND provider_payment_id = p_provider_payment_id
    LIMIT 1;

    IF FOUND THEN
        UPDATE payments SET
            status = v_norm_status,
            amount = p_amount,
            pix_copy_paste = COALESCE(NULLIF(p_pix_copy_paste, ''), pix_copy_paste),
            raw_payload = p_raw,
            updated_at = NOW()
        WHERE id = v_payment_id;
    ELSE
        INSERT INTO payments (
            order_id, provider_payment_id, status, amount, pix_copy_paste, raw_payload
        ) VALUES (
            p_order_id, p_provider_payment_id, v_norm_status, p_amount,
            COALESCE(p_pix_copy_paste, ''), p_raw
        ) RETURNING id INTO v_payment_id;
    END IF;

    RETURN v_payment_id;
END;
$$;

-- Permite anon chamar upsert via wrapper (SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION attach_order_payment_public(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB)
    TO anon, authenticated;

-- ── Consultas públicas ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_order_by_tracking(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_items JSONB;
    v_payment JSONB;
BEGIN
    SELECT * INTO v_order FROM orders WHERE tracking_token = p_token;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(oi)), '[]'::JSONB) INTO v_items
    FROM order_items oi WHERE oi.order_id = v_order.id;

    SELECT to_jsonb(p) INTO v_payment
    FROM payments p WHERE p.order_id = v_order.id
    ORDER BY p.created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
        'order', to_jsonb(v_order),
        'items', v_items,
        'payment', v_payment
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_order_by_tracking(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION list_orders_by_customer(p_customer_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_customer_id IS NULL THEN
        RETURN '[]'::JSONB;
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'order', to_jsonb(o),
                'payment', (
                    SELECT to_jsonb(p) FROM payments p
                    WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1
                )
            )
            ORDER BY o.created_at DESC
        )
        FROM orders o
        WHERE o.customer_id = p_customer_id
        LIMIT GREATEST(p_limit, 1)
    ), '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION list_orders_by_customer(UUID, INTEGER) TO anon, authenticated;

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
    UPDATE orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_unpaid_order(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION request_order_refund(
    p_order_id UUID,
    p_customer_id UUID,
    p_reason TEXT DEFAULT ''
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_payment_id UUID;
    v_refund_id UUID;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Pedido não pertence ao cliente';
    END IF;
    IF v_order.status <> 'paid' THEN
        RAISE EXCEPTION 'Reembolso só para pedidos pagos';
    END IF;

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND status = 'approved'
    ORDER BY created_at DESC LIMIT 1;

    IF EXISTS (
        SELECT 1 FROM refund_requests
        WHERE order_id = p_order_id AND status IN ('pending', 'approved')
    ) THEN
        RAISE EXCEPTION 'Já existe solicitação de reembolso em andamento';
    END IF;

    INSERT INTO refund_requests (order_id, payment_id, reason, status)
    VALUES (p_order_id, v_payment_id, COALESCE(p_reason, ''), 'pending')
    RETURNING id INTO v_refund_id;

    UPDATE orders SET status = 'refund_requested' WHERE id = p_order_id;

    RETURN v_refund_id;
END;
$$;

GRANT EXECUTE ON FUNCTION request_order_refund(UUID, UUID, TEXT) TO anon, authenticated;

-- ── Processar reembolso aprovado (admin via RPC após MP) ────
CREATE OR REPLACE FUNCTION mark_order_refunded(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale RECORD;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    UPDATE orders SET status = 'refunded' WHERE id = p_order_id;
    UPDATE payments SET status = 'refunded', updated_at = NOW()
    WHERE order_id = p_order_id;

    FOR v_sale IN
        SELECT id FROM sales WHERE order_id = p_order_id AND cancelled_at IS NULL
    LOOP
        PERFORM cancel_sale(v_sale.id);
    END LOOP;

    UPDATE refund_requests SET status = 'processed', processed_at = NOW()
    WHERE order_id = p_order_id AND status = 'approved';
END;
$$;

GRANT EXECUTE ON FUNCTION mark_order_refunded(UUID) TO authenticated;
