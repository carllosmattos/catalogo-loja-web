-- 039_payment_cancel_sync_and_sale_guards.sql
-- 1) Sync/webhook: payment cancelled/rejected/expired → cancela pedido unpaid
-- 2) Repara pedidos órfãos (payment cancelado, order ainda pending_payment)
-- 3) cancel_sale: bloqueia se houver payment approved; cancela payments/pedido pendentes

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
    IF v_norm = 'canceled' THEN
        v_norm := 'cancelled';
    END IF;
    IF v_norm NOT IN (
        'pending', 'approved', 'rejected', 'cancelled',
        'refunded', 'in_process', 'expired'
    ) THEN
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

    -- PIX cancelado/recusado/expirado: alinha o pedido (libera reserva)
    IF v_norm IN ('cancelled', 'rejected', 'expired')
       AND v_order.status = 'pending_payment' THEN
        BEGIN
            PERFORM _release_order_reservations(p_order_id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        UPDATE orders
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
        WHERE id = p_order_id;

        UPDATE payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE order_id = p_order_id
          AND id IS DISTINCT FROM v_payment_id
          AND status IN ('pending', 'in_process');
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
    IF v_norm = 'canceled' THEN
        v_norm := 'cancelled';
    END IF;
    IF v_norm NOT IN (
        'pending', 'approved', 'rejected', 'cancelled',
        'refunded', 'in_process', 'expired'
    ) THEN
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

    IF v_norm IN ('cancelled', 'rejected', 'expired')
       AND v_order.status = 'pending_payment' THEN
        BEGIN
            PERFORM _release_order_reservations(p_order_id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        UPDATE orders
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
        WHERE id = p_order_id;

        UPDATE payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE order_id = p_order_id
          AND id IS DISTINCT FROM v_payment_id
          AND status IN ('pending', 'in_process');
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

-- Reparo de inconsistências já existentes
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT o.id
        FROM orders o
        WHERE o.status = 'pending_payment'
          AND EXISTS (
              SELECT 1 FROM payments p
              WHERE p.order_id = o.id
                AND p.status IN ('cancelled', 'rejected', 'expired')
          )
          AND NOT EXISTS (
              SELECT 1 FROM payments p2
              WHERE p2.order_id = o.id
                AND p2.status IN ('pending', 'in_process', 'approved')
          )
    LOOP
        BEGIN
            PERFORM _release_order_reservations(r.id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
        UPDATE orders
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
        WHERE id = r.id;
    END LOOP;
END;
$$;

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
    v_size TEXT;
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

    -- Pagamento aprovado: não cancelar (use estorno)
    IF EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.status = 'approved'
          AND (
              (v_sale.payment_id IS NOT NULL AND p.id = v_sale.payment_id)
              OR (v_sale.order_id IS NOT NULL AND p.order_id = v_sale.order_id)
          )
    ) THEN
        RAISE EXCEPTION
            'Não é possível cancelar venda com pagamento aprovado. Use estorno/reembolso do pedido.';
    END IF;

    v_qty := GREATEST(COALESCE(v_sale.quantity, 1), 1);
    v_size := UPPER(TRIM(COALESCE(NULLIF(v_sale.product_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    IF v_sale.product_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM product_sizes
            WHERE product_id = v_sale.product_id AND size = v_size
        ) THEN
            PERFORM adjust_product_stock(
                v_sale.product_id, v_size, 'in', v_qty,
                'Cancelamento de venda', NULL, 'sale', p_sale_id, FALSE
            );
        ELSE
            UPDATE products
            SET stock = stock + v_qty, updated_at = NOW()
            WHERE id = v_sale.product_id;
        END IF;
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

    -- Cancela payments pendentes e pedido unpaid ligado
    IF v_sale.order_id IS NOT NULL THEN
        UPDATE payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE order_id = v_sale.order_id
          AND status IN ('pending', 'in_process', 'rejected', 'expired');

        IF EXISTS (
            SELECT 1 FROM orders
            WHERE id = v_sale.order_id AND status = 'pending_payment'
        ) THEN
            BEGIN
                PERFORM _release_order_reservations(v_sale.order_id);
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
            UPDATE orders
            SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
            WHERE id = v_sale.order_id;
        END IF;
    ELSIF v_sale.payment_id IS NOT NULL THEN
        UPDATE payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = v_sale.payment_id
          AND status IN ('pending', 'in_process', 'rejected', 'expired');
    END IF;

    UPDATE sales
    SET cancelled_at = NOW()
    WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_sale TO authenticated;

NOTIFY pgrst, 'reload schema';
