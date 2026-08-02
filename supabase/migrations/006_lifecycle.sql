-- 006_lifecycle.sql
-- Arquivamento de brindes e cancelamento de vendas com devolução de estoque

ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_gifts_active ON gifts(active);

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sales_cancelled ON sales(cancelled_at);

-- Cancela venda (soft delete) e devolve estoque de produto e brindes
CREATE OR REPLACE FUNCTION cancel_sale(p_sale_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale RECORD;
    v_gift RECORD;
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

    IF v_sale.product_id IS NOT NULL THEN
        UPDATE products
        SET stock = stock + 1, updated_at = NOW()
        WHERE id = v_sale.product_id;
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

    UPDATE sales
    SET cancelled_at = NOW()
    WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_sale TO authenticated;
