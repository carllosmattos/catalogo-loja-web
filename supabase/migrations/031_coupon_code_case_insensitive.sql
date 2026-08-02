-- 031_coupon_code_case_insensitive.sql
-- Cupons no formato LM-TIPO-a9F5: busca case-insensitive, preserva máscara.

CREATE OR REPLACE FUNCTION normalize_coupon_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT upper(regexp_replace(trim(COALESCE(p_code, '')), '\s+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION validate_coupon(
    p_code TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_subtotal NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_coupon_code(p_code);
    v_c coupons%ROWTYPE;
    v_discount NUMERIC;
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

    IF v_c.discount_type = 'percent' THEN
        v_discount := ROUND(GREATEST(p_subtotal, 0) * (v_c.discount_value / 100.0), 2);
    ELSE
        v_discount := LEAST(v_c.discount_value, GREATEST(p_subtotal, 0));
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'coupon_id', v_c.id,
        'code', v_c.code,
        'title', v_c.title,
        'discount_type', v_c.discount_type,
        'discount_value', v_c.discount_value,
        'discount_amount', v_discount,
        'image_url', COALESCE(v_c.image_url, '')
    );
END;
$$;

CREATE OR REPLACE FUNCTION redeem_coupon(
    p_code TEXT,
    p_customer_id UUID,
    p_order_id UUID,
    p_discount_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_coupon_code(p_code);
    v_c coupons%ROWTYPE;
BEGIN
    IF v_code = '' OR p_order_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Dados inválidos');
    END IF;

    SELECT * INTO v_c FROM coupons WHERE upper(code) = v_code FOR UPDATE;
    IF NOT FOUND OR NOT v_c.active OR v_c.used_count >= v_c.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom indisponível');
    END IF;

    IF EXISTS (SELECT 1 FROM coupon_redemptions WHERE order_id = p_order_id LIMIT 1) THEN
        RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;

    IF p_customer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM coupon_redemptions
        WHERE coupon_id = v_c.id AND customer_id = p_customer_id
        LIMIT 1
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom já utilizado');
    END IF;

    UPDATE coupons
    SET used_count = used_count + 1, updated_at = NOW()
    WHERE id = v_c.id;

    INSERT INTO coupon_redemptions (coupon_id, customer_id, order_id, discount_amount)
    VALUES (v_c.id, p_customer_id, p_order_id, GREATEST(COALESCE(p_discount_amount, 0), 0));

    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_upper_unique
    ON coupons (upper(code));

NOTIFY pgrst, 'reload schema';
