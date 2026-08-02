-- 021_phone_lookup_and_payment_rpcs.sql
-- Lookup por telefone normalizado + RPCs de pedido/pagamento (reparo se 016 incompleto).

-- ── Normalização telefone BR (55 + DDD + número) ────────────
CREATE OR REPLACE FUNCTION normalize_phone_br(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v TEXT;
BEGIN
    v := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
    IF length(v) < 10 THEN
        RETURN v;
    END IF;
    IF v LIKE '55%' AND length(v) >= 12 THEN
        v := substring(v from 3);
    END IF;
    IF length(v) IN (10, 11) THEN
        RETURN '55' || v;
    END IF;
    IF length(v) > 11 THEN
        RETURN '55' || right(v, 11);
    END IF;
    RETURN '55' || v;
END;
$$;

-- Normaliza telefones legados (best-effort)
UPDATE customers
SET phone = normalize_phone_br(phone), updated_at = NOW()
WHERE phone <> '' AND phone <> normalize_phone_br(phone);

-- ── Lookup por telefone (match flexível) ─────────────────────
CREATE OR REPLACE FUNCTION lookup_customer_by_phone(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_digits TEXT;
    v_norm TEXT;
    v_row customers%ROWTYPE;
BEGIN
    v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    IF length(v_digits) < 10 THEN
        RETURN NULL;
    END IF;
    v_norm := normalize_phone_br(v_digits);

    SELECT * INTO v_row FROM customers WHERE normalize_phone_br(phone) = v_norm LIMIT 1;
    IF FOUND THEN
        RETURN to_jsonb(v_row);
    END IF;

    SELECT * INTO v_row FROM customers WHERE phone = v_digits LIMIT 1;
    IF FOUND THEN
        RETURN to_jsonb(v_row);
    END IF;

    SELECT * INTO v_row FROM customers
    WHERE right(regexp_replace(phone, '\D', '', 'g'), 11) = right(v_norm, 11)
    LIMIT 1;
    IF FOUND THEN
        RETURN to_jsonb(v_row);
    END IF;

    SELECT * INTO v_row FROM customers
    WHERE right(regexp_replace(phone, '\D', '', 'g'), 10) = right(v_norm, 10)
    LIMIT 1;
    IF FOUND THEN
        RETURN to_jsonb(v_row);
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_customer_by_phone(TEXT) TO anon, authenticated;

-- save_customer_profile com telefone normalizado
CREATE OR REPLACE FUNCTION save_customer_profile(
    p_name TEXT,
    p_phone TEXT,
    p_cpf TEXT,
    p_address TEXT DEFAULT '',
    p_email TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
    v_cpf TEXT;
    v_email TEXT;
    v_row customers%ROWTYPE;
BEGIN
    v_phone := normalize_phone_br(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'));
    v_cpf := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
    v_email := lower(trim(COALESCE(p_email, '')));

    IF length(v_phone) < 12 THEN
        RAISE EXCEPTION 'Telefone inválido';
    END IF;
    IF length(v_cpf) <> 11 THEN
        RAISE EXCEPTION 'CPF inválido';
    END IF;
    IF trim(COALESCE(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Nome obrigatório';
    END IF;
    IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'E-mail inválido';
    END IF;

    SELECT * INTO v_row FROM customers WHERE cpf = v_cpf LIMIT 1;

    IF FOUND THEN
        UPDATE customers SET
            name = trim(p_name),
            phone = v_phone,
            email = v_email,
            address = COALESCE(p_address, ''),
            updated_at = NOW()
        WHERE id = v_row.id
        RETURNING * INTO v_row;
    ELSE
        SELECT * INTO v_row FROM customers
        WHERE normalize_phone_br(phone) = v_phone LIMIT 1;
        IF FOUND THEN
            UPDATE customers SET
                name = trim(p_name),
                cpf = v_cpf,
                email = v_email,
                address = COALESCE(p_address, ''),
                updated_at = NOW()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
        ELSE
            INSERT INTO customers (name, phone, cpf, email, address, points)
            VALUES (trim(p_name), v_phone, v_cpf, v_email, COALESCE(p_address, ''), 0)
            RETURNING * INTO v_row;
        END IF;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION save_customer_profile(TEXT, TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated;

-- ── Tracking por token TEXT (020) ─────────────────────────────
DROP FUNCTION IF EXISTS get_order_by_tracking(UUID);

CREATE OR REPLACE FUNCTION get_order_by_tracking(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_items JSONB;
    v_payment JSONB;
    v_uuid UUID;
BEGIN
    IF p_token IS NULL OR btrim(p_token) = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        v_uuid := btrim(p_token)::UUID;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    SELECT * INTO v_order FROM orders WHERE tracking_token = v_uuid;
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

GRANT EXECUTE ON FUNCTION get_order_by_tracking(TEXT) TO anon, authenticated;

-- ── Lista pedidos do cliente (subquery ordenada) ─────────────
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
        SELECT jsonb_agg(row_data ORDER BY sort_at DESC)
        FROM (
            SELECT
                jsonb_build_object(
                    'order', to_jsonb(o),
                    'payment', (
                        SELECT to_jsonb(p) FROM payments p
                        WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1
                    )
                ) AS row_data,
                o.created_at AS sort_at
            FROM orders o
            WHERE o.customer_id = p_customer_id
            ORDER BY o.created_at DESC
            LIMIT GREATEST(p_limit, 1)
        ) sub
    ), '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION list_orders_by_customer(UUID, INTEGER) TO anon, authenticated;

-- ── Cancelar / reembolso ─────────────────────────────────────
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
    UPDATE payments SET status = 'cancelled', updated_at = NOW()
    WHERE order_id = p_order_id AND status = 'pending';
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

-- Webhook RPCs (service_role)
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

NOTIFY pgrst, 'reload schema';
