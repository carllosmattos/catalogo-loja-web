-- 040_stock_reserve_service_role_and_available.sql
-- 1) service_role pode cancelar unpaid / expirar (admin PIX)
-- 2) Estoque disponível (físico - reservas) para o admin
-- 3) Mensagens de estoque mais claras quando há reserva PIX

GRANT EXECUTE ON FUNCTION cancel_unpaid_order(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION expire_stale_orders() TO service_role;

CREATE OR REPLACE FUNCTION available_product_stock(
    p_product_id UUID,
    p_size TEXT DEFAULT 'M'
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    PERFORM expire_stale_orders();
    RETURN _available_product_stock(p_product_id, p_size, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION available_product_stock(UUID, TEXT)
    TO anon, authenticated, service_role;

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
    v_phys INTEGER;
    v_reserved INTEGER;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_qty INTEGER;
    v_name TEXT;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::UUID;
        v_qty := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
        v_size := UPPER(TRIM(COALESCE(NULLIF(v_item->>'product_size', ''), 'M')));
        IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
            v_size := 'M';
        END IF;
        v_name := COALESCE(v_item->>'product_name', 'produto');
        v_avail := _available_product_stock(v_pid, v_size, NULL);

        IF v_avail < v_qty THEN
            IF EXISTS (
                SELECT 1 FROM product_sizes
                WHERE product_id = v_pid AND size = v_size
            ) THEN
                SELECT stock INTO v_phys FROM product_sizes
                WHERE product_id = v_pid AND size = v_size;
            ELSE
                SELECT stock INTO v_phys FROM products WHERE id = v_pid;
            END IF;

            SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
            FROM stock_reservations
            WHERE product_id = v_pid
              AND product_size = v_size
              AND expires_at > NOW();

            IF v_reserved > 0 THEN
                RAISE EXCEPTION
                    'Estoque insuficiente para % (disponível %; % unidade(s) reservada(s) em PIX pendente de até 15 min)',
                    v_name,
                    v_avail,
                    v_reserved;
            END IF;

            RAISE EXCEPTION 'Estoque insuficiente para % (disponível %)', v_name, v_avail;
        END IF;

        FOR v_gift IN SELECT * FROM jsonb_array_elements(
            COALESCE(v_item->'gifts_snapshot', '[]'::JSONB)
        )
        LOOP
            v_gift_id := (v_gift->>'gift_id')::UUID;
            v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
            IF _available_gift_stock(v_gift_id, NULL) < v_gift_qty THEN
                RAISE EXCEPTION
                    'Estoque de brinde insuficiente (pode estar reservado em outro PIX pendente)';
            END IF;
        END LOOP;
    END LOOP;
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
    v_name TEXT;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::UUID;
        v_qty := GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1);
        v_size := UPPER(TRIM(COALESCE(NULLIF(v_item->>'product_size', ''), 'M')));
        IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
            v_size := 'M';
        END IF;
        v_name := COALESCE(v_item->>'product_name', 'produto');

        v_avail := _available_product_stock(v_pid, v_size, p_order_id);
        IF v_avail < v_qty THEN
            RAISE EXCEPTION
                'Estoque insuficiente para % (disponível %; aguarde expirar PIX pendente ou cancele em Pagamentos)',
                v_name,
                v_avail;
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
                RAISE EXCEPTION
                    'Estoque de brinde insuficiente (reservado em outro PIX pendente)';
            END IF;
            INSERT INTO stock_reservations (
                order_id, gift_id, product_size, quantity, expires_at
            ) VALUES (p_order_id, v_gift_id, 'M', v_gift_qty, p_expires_at);
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
