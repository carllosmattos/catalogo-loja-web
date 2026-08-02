-- 017_repair_payment_rpcs.sql
-- Bootstrap completo se 016 não rodou: tabelas + policies + RPCs do checkout.
-- Rode UMA vez no SQL Editor (idempotente — pode rodar de novo).

-- E-mail do cliente (015)
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

-- ── Tabelas (016) ───────────────────────────────────────────
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

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_order ON sales(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment ON sales(payment_id);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

-- Policies idempotentes
DROP POLICY IF EXISTS orders_auth_all ON orders;
DROP POLICY IF EXISTS order_items_auth_all ON order_items;
DROP POLICY IF EXISTS payments_auth_all ON payments;
DROP POLICY IF EXISTS refund_requests_auth_all ON refund_requests;

CREATE POLICY orders_auth_all ON orders
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY order_items_auth_all ON order_items
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY payments_auth_all ON payments
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY refund_requests_auth_all ON refund_requests
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Recria RPC principal (copiado da 016)
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

-- attach_order_payment_public (checkout PIX)
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

GRANT EXECUTE ON FUNCTION attach_order_payment_public(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB)
    TO anon, authenticated;

-- Força PostgREST a recarregar o schema
NOTIFY pgrst, 'reload schema';
