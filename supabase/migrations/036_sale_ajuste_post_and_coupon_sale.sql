-- 036_sale_ajuste_post_and_coupon_sale.sql
-- Ajuste de frete real pós-venda + resgate de cupom em venda manual (sale_id)

ALTER TABLE coupon_redemptions
    ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_sale
    ON coupon_redemptions(sale_id);

-- Atualiza ajuste depois da venda (recalcula lucro)
CREATE OR REPLACE FUNCTION update_sale_ajuste(
    p_sale_id UUID,
    p_ajuste_valor NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale sales%ROWTYPE;
    v_ajuste NUMERIC(10,2);
    v_lucro NUMERIC(10,2);
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    IF p_sale_id IS NULL THEN
        RAISE EXCEPTION 'Venda não informada';
    END IF;

    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venda não encontrada';
    END IF;
    IF v_sale.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION 'Venda cancelada — não é possível ajustar';
    END IF;

    v_ajuste := COALESCE(p_ajuste_valor, 0);
    v_lucro := COALESCE(v_sale.preco_final, 0)
        - COALESCE(v_sale.custo_peca, 0)
        - COALESCE(v_sale.custo_brindes, 0)
        - v_ajuste;

    UPDATE sales
    SET ajuste_valor = v_ajuste,
        lucro = v_lucro
    WHERE id = p_sale_id;

    RETURN jsonb_build_object(
        'sale_id', p_sale_id,
        'ajuste_valor', v_ajuste,
        'lucro', v_lucro
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_sale_ajuste(UUID, NUMERIC) TO authenticated;

-- Resgate de cupom: pedido online OU venda manual
DROP FUNCTION IF EXISTS redeem_coupon(TEXT, UUID, UUID, NUMERIC);

CREATE OR REPLACE FUNCTION redeem_coupon(
    p_code TEXT,
    p_customer_id UUID,
    p_order_id UUID,
    p_discount_amount NUMERIC,
    p_sale_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_coupon_code(p_code);
    v_c coupons%ROWTYPE;
BEGIN
    IF v_code = '' OR (p_order_id IS NULL AND p_sale_id IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Dados inválidos');
    END IF;

    SELECT * INTO v_c FROM coupons WHERE upper(code) = v_code FOR UPDATE;
    IF NOT FOUND OR NOT v_c.active OR v_c.used_count >= v_c.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom indisponível');
    END IF;

    IF p_order_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM coupon_redemptions WHERE order_id = p_order_id LIMIT 1
    ) THEN
        RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;

    IF p_sale_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM coupon_redemptions WHERE sale_id = p_sale_id LIMIT 1
    ) THEN
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

    INSERT INTO coupon_redemptions (
        coupon_id, customer_id, order_id, sale_id, discount_amount
    ) VALUES (
        v_c.id,
        p_customer_id,
        p_order_id,
        p_sale_id,
        GREATEST(COALESCE(p_discount_amount, 0), 0)
    );

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_coupon(TEXT, UUID, UUID, NUMERIC, UUID)
    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
