-- 038_coupon_shipping_deferred_uber.sql
-- Cupom de frete válido sem frete cotado (Uber): desconto fixo já conhecido;
-- percentual % fica 0 até o admin lançar o custo real pós-envio.

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
    v_deferred BOOLEAN := false;
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
            -- Uber / frete a combinar: cupom de frete ainda vale
            v_deferred := true;
            IF v_c.discount_type = 'percent' THEN
                -- % sem base: valor real só no envio (admin)
                v_discount := 0;
            ELSE
                v_discount := GREATEST(COALESCE(v_c.discount_value, 0), 0);
            END IF;
        ELSE
            IF v_c.discount_type = 'percent' THEN
                v_discount := ROUND(v_base * (v_c.discount_value / 100.0), 2);
            ELSE
                v_discount := LEAST(v_c.discount_value, v_base);
            END IF;
        END IF;
    ELSE
        v_target := 'product';
        v_base := GREATEST(COALESCE(p_subtotal, 0), 0);
        IF v_c.discount_type = 'percent' THEN
            v_discount := ROUND(v_base * (v_c.discount_value / 100.0), 2);
        ELSE
            v_discount := LEAST(v_c.discount_value, v_base);
        END IF;
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
        'image_url', COALESCE(v_c.image_url, ''),
        'shipping_deferred', v_deferred
    );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_coupon(TEXT, UUID, NUMERIC, NUMERIC)
    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
