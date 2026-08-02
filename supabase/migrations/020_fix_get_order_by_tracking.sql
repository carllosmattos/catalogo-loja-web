-- 020_fix_get_order_by_tracking.sql
-- Aceita token como TEXT (URL do catálogo) e evita erro de UUID inválido.

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
        WHEN invalid_text_representation THEN
            RETURN NULL;
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

NOTIFY pgrst, 'reload schema';
