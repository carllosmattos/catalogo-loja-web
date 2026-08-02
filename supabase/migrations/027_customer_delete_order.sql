-- 027_customer_delete_order.sql
-- Cliente pode remover pedido da lista (soft-delete) e, se pendente, cancela + libera estoque.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_customer_visible
    ON orders (customer_id, created_at DESC)
    WHERE customer_hidden_at IS NULL;

CREATE OR REPLACE FUNCTION delete_customer_order(
    p_order_id UUID,
    p_customer_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
BEGIN
    IF p_order_id IS NULL OR p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Dados inválidos';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Pedido não pertence ao cliente';
    END IF;
    IF v_order.customer_hidden_at IS NOT NULL THEN
        RETURN;
    END IF;

    -- Pedido aguardando PIX: cancela e libera reserva antes de esconder
    IF v_order.status = 'pending_payment' THEN
        PERFORM _release_order_reservations(p_order_id);

        UPDATE orders
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            customer_hidden_at = NOW()
        WHERE id = p_order_id;

        UPDATE payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE order_id = p_order_id AND status = 'pending';
    ELSE
        UPDATE orders
        SET customer_hidden_at = NOW()
        WHERE id = p_order_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_customer_order(UUID, UUID) TO anon, authenticated, service_role;

-- Lista só pedidos visíveis para o cliente
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
              AND o.customer_hidden_at IS NULL
            ORDER BY o.created_at DESC
            LIMIT GREATEST(p_limit, 1)
        ) sub
    ), '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION list_orders_by_customer(UUID, INTEGER) TO anon, authenticated, service_role;
