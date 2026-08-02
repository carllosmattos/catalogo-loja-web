-- 034_stock_movements_and_sale_cost_snapshot.sql
-- Histórico profissional de estoque + custo congelado na venda (lucro imutável)

-- ── Snapshot de custo na venda ──────────────────────────────
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS custo_peca NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS custo_brindes NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales.lucro IS 'Lucro bruto no momento da venda (não recalcular).';
COMMENT ON COLUMN sales.custo_peca IS 'Custo da peça (compra+frete) × qtd no momento da venda.';
COMMENT ON COLUMN sales.custo_brindes IS 'Custo dos brindes no momento da venda.';

-- ── Movimentos de estoque ─────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_size TEXT NOT NULL DEFAULT 'U'
        CHECK (product_size IN ('U', 'P', 'M', 'G')),
    movement_type TEXT NOT NULL
        CHECK (movement_type IN (
            'in',           -- entrada / compra
            'out_sale',     -- saída por venda
            'out_other',    -- saída (perda, brinde avulso, etc.)
            'adjust'        -- ajuste inventário
        )),
    quantity INTEGER NOT NULL,  -- positivo = entra, negativo = sai (ou delta no adjust)
    stock_before INTEGER NOT NULL DEFAULT 0,
    stock_after INTEGER NOT NULL DEFAULT 0,
    unit_cost NUMERIC(10,2),    -- custo unitário na entrada (opcional)
    reason TEXT NOT NULL DEFAULT '',
    reference_type TEXT,        -- 'sale' | 'order' | 'manual' | null
    reference_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
    ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created
    ON stock_movements(created_at DESC);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_movements_auth_all ON stock_movements;
CREATE POLICY stock_movements_auth_all ON stock_movements
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Garante linha em product_sizes
CREATE OR REPLACE FUNCTION _ensure_product_size(
    p_product_id UUID,
    p_size TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO product_sizes (product_id, size, stock)
    VALUES (p_product_id, p_size, 0)
    ON CONFLICT (product_id, size) DO NOTHING;
END;
$$;

-- Ajuste/entrada/saída de estoque com histórico
CREATE OR REPLACE FUNCTION adjust_product_stock(
    p_product_id UUID,
    p_size TEXT,
    p_movement_type TEXT,
    p_quantity INTEGER,
    p_reason TEXT DEFAULT '',
    p_unit_cost NUMERIC DEFAULT NULL,
    p_reference_type TEXT DEFAULT 'manual',
    p_reference_id UUID DEFAULT NULL,
    p_set_absolute BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_size TEXT;
    v_before INTEGER;
    v_after INTEGER;
    v_delta INTEGER;
    v_type TEXT;
BEGIN
    IF p_product_id IS NULL THEN
        RAISE EXCEPTION 'Produto não informado';
    END IF;

    v_size := UPPER(TRIM(COALESCE(NULLIF(p_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    v_type := lower(trim(p_movement_type));
    IF v_type NOT IN ('in', 'out_sale', 'out_other', 'adjust') THEN
        RAISE EXCEPTION 'Tipo de movimento inválido';
    END IF;

    PERFORM _ensure_product_size(p_product_id, v_size);

    SELECT stock INTO v_before
    FROM product_sizes
    WHERE product_id = p_product_id AND size = v_size
    FOR UPDATE;

    v_before := COALESCE(v_before, 0);

    IF p_set_absolute THEN
        -- quantity = estoque desejado
        v_after := GREATEST(COALESCE(p_quantity, 0), 0);
        v_delta := v_after - v_before;
        v_type := 'adjust';
    ELSE
        v_delta := COALESCE(p_quantity, 0);
        IF v_type IN ('out_sale', 'out_other') AND v_delta > 0 THEN
            v_delta := -v_delta;
        END IF;
        IF v_type = 'in' AND v_delta < 0 THEN
            RAISE EXCEPTION 'Entrada deve ser quantidade positiva';
        END IF;
        v_after := v_before + v_delta;
        IF v_after < 0 THEN
            RAISE EXCEPTION 'Estoque insuficiente (atual %, movimento %)', v_before, v_delta;
        END IF;
    END IF;

    IF v_delta = 0 AND NOT p_set_absolute THEN
        RETURN jsonb_build_object(
            'product_id', p_product_id,
            'size', v_size,
            'stock_before', v_before,
            'stock_after', v_after,
            'unchanged', true
        );
    END IF;

    UPDATE product_sizes
    SET stock = v_after
    WHERE product_id = p_product_id AND size = v_size;

    -- sync products.stock total
    UPDATE products
    SET stock = (
        SELECT COALESCE(SUM(stock), 0) FROM product_sizes WHERE product_id = p_product_id
    ),
    updated_at = NOW()
    WHERE id = p_product_id;

    INSERT INTO stock_movements (
        product_id, product_size, movement_type, quantity,
        stock_before, stock_after, unit_cost, reason,
        reference_type, reference_id, created_by
    ) VALUES (
        p_product_id, v_size, v_type, v_delta,
        v_before, v_after, p_unit_cost, COALESCE(p_reason, ''),
        p_reference_type, p_reference_id, auth.uid()
    );

    RETURN jsonb_build_object(
        'product_id', p_product_id,
        'size', v_size,
        'movement_type', v_type,
        'delta', v_delta,
        'stock_before', v_before,
        'stock_after', v_after
    );
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_product_stock(
    UUID, TEXT, TEXT, INTEGER, TEXT, NUMERIC, TEXT, UUID, BOOLEAN
) TO authenticated;

-- Atualiza fulfill para gravar custo congelado + movimento de saída
CREATE OR REPLACE FUNCTION _fulfill_order_item(
    p_order_id UUID,
    p_item_id UUID,
    p_payment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_item order_items%ROWTYPE;
    v_sale_id UUID;
    v_size TEXT;
    v_has_size_row BOOLEAN;
    v_size_stock INTEGER;
    v_product_stock INTEGER;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_name TEXT;
    v_gift_qty INTEGER;
    v_gift_stock INTEGER;
    v_qty INTEGER;
    v_custo_peca NUMERIC(10,2) := 0;
    v_custo_brindes NUMERIC(10,2) := 0;
    v_custo_gift NUMERIC(10,2) := 0;
    v_lucro NUMERIC(10,2) := 0;
    v_purchase_price NUMERIC(10,2) := 0;
    v_purchase_freight NUMERIC(10,2) := 0;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;

    SELECT * INTO v_item FROM order_items WHERE id = p_item_id AND order_id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item do pedido não encontrado';
    END IF;

    v_qty := GREATEST(COALESCE(v_item.quantity, 1), 1);
    v_size := UPPER(TRIM(COALESCE(NULLIF(v_item.product_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    IF v_item.product_id IS NOT NULL THEN
        SELECT COALESCE(purchase_price, 0), COALESCE(purchase_freight, 0)
        INTO v_purchase_price, v_purchase_freight
        FROM products WHERE id = v_item.product_id;
        v_custo_peca := (v_purchase_price + v_purchase_freight) * v_qty;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM product_sizes
        WHERE product_id = v_item.product_id AND size = v_size
    ) INTO v_has_size_row;

    IF v_has_size_row THEN
        SELECT stock INTO v_size_stock
        FROM product_sizes
        WHERE product_id = v_item.product_id AND size = v_size
        FOR UPDATE;
        IF v_size_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', v_item.product_name;
        END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_product_stock
        FROM products WHERE id = v_item.product_id FOR UPDATE;
        IF NOT FOUND OR v_product_stock < v_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para %', v_item.product_name;
        END IF;
    END IF;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        BEGIN
            v_gift_id := (v_gift->>'gift_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        IF v_gift_id IS NULL THEN CONTINUE; END IF;
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        SELECT stock,
               (COALESCE(purchase_price, 0) + COALESCE(purchase_freight, 0)) * v_gift_qty
        INTO v_gift_stock, v_custo_gift
        FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND OR v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque de brinde insuficiente';
        END IF;
        v_custo_brindes := v_custo_brindes + COALESCE(v_custo_gift, 0);
    END LOOP;

    -- Lucro congelado no momento da baixa (não recalcula se o cadastro mudar depois)
    v_lucro := COALESCE(v_item.preco_final_line, 0) - v_custo_peca - v_custo_brindes;

    INSERT INTO sales (
        customer_name, customer_phone, customer_id, customer_cpf,
        product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity,
        order_id, payment_id, custo_peca, custo_brindes
    ) VALUES (
        v_order.customer_name, v_order.customer_phone, v_order.customer_id,
        v_order.customer_cpf,
        v_item.product_id, v_item.product_name, v_size,
        v_item.preco_catalogo, v_item.desconto, v_item.sale_freight,
        v_item.preco_final_line,
        v_item.promotion_id, v_item.promotion_name, v_lucro,
        COALESCE(v_order.notes, ''), v_qty,
        v_order.id, p_payment_id, v_custo_peca, v_custo_brindes
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.gifts_snapshot, '[]'::JSONB))
    LOOP
        BEGIN
            v_gift_id := (v_gift->>'gift_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        IF v_gift_id IS NULL THEN CONTINUE; END IF;
        v_gift_name := COALESCE(v_gift->>'gift_name', 'Brinde');
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);
        UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    IF v_has_size_row AND v_item.product_id IS NOT NULL THEN
        PERFORM adjust_product_stock(
            v_item.product_id, v_size, 'out_sale', v_qty,
            'Venda online', NULL, 'sale', v_sale_id, FALSE
        );
    ELSIF v_item.product_id IS NOT NULL THEN
        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = v_item.product_id;
        INSERT INTO stock_movements (
            product_id, product_size, movement_type, quantity,
            stock_before, stock_after, reason, reference_type, reference_id
        ) VALUES (
            v_item.product_id, v_size, 'out_sale', -v_qty,
            COALESCE(v_product_stock, 0), COALESCE(v_product_stock, 0) - v_qty,
            'Venda online (estoque legado)', 'sale', v_sale_id
        );
    END IF;

    RETURN v_sale_id;
END;
$$;

-- Venda manual: congela custo/lucro + movimento de saída
CREATE OR REPLACE FUNCTION register_sale(
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_product_id UUID,
    p_product_name TEXT,
    p_product_size TEXT,
    p_preco_catalogo NUMERIC,
    p_desconto NUMERIC,
    p_sale_freight NUMERIC,
    p_preco_final NUMERIC,
    p_promotion_id UUID,
    p_promotion_name TEXT,
    p_lucro NUMERIC,
    p_notes TEXT,
    p_gifts JSONB DEFAULT '[]'::JSONB,
    p_quantity INTEGER DEFAULT 1,
    p_customer_id UUID DEFAULT NULL,
    p_customer_cpf TEXT DEFAULT ''
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale_id UUID;
    v_size TEXT;
    v_has_size_row BOOLEAN;
    v_gift JSONB;
    v_gift_id UUID;
    v_gift_name TEXT;
    v_gift_qty INTEGER;
    v_gift_stock INTEGER;
    v_qty INTEGER;
    v_custo_peca NUMERIC(10,2) := 0;
    v_custo_brindes NUMERIC(10,2) := 0;
    v_custo_gift NUMERIC(10,2) := 0;
    v_lucro NUMERIC(10,2) := 0;
    v_purchase_price NUMERIC(10,2) := 0;
    v_purchase_freight NUMERIC(10,2) := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    v_qty := GREATEST(COALESCE(p_quantity, 1), 1);
    v_size := UPPER(TRIM(COALESCE(NULLIF(p_product_size, ''), 'M')));
    IF v_size NOT IN ('U', 'P', 'M', 'G') THEN
        v_size := 'M';
    END IF;

    SELECT COALESCE(purchase_price, 0), COALESCE(purchase_freight, 0)
    INTO v_purchase_price, v_purchase_freight
    FROM products WHERE id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado';
    END IF;
    v_custo_peca := (v_purchase_price + v_purchase_freight) * v_qty;

    SELECT EXISTS (
        SELECT 1 FROM product_sizes
        WHERE product_id = p_product_id AND size = v_size
    ) INTO v_has_size_row;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        SELECT stock,
               (COALESCE(purchase_price, 0) + COALESCE(purchase_freight, 0)) * v_gift_qty
        INTO v_gift_stock, v_custo_gift
        FROM gifts WHERE id = v_gift_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Brinde não encontrado';
        END IF;
        IF v_gift_stock < v_gift_qty THEN
            RAISE EXCEPTION 'Estoque do brinde insuficiente';
        END IF;
        v_custo_brindes := v_custo_brindes + COALESCE(v_custo_gift, 0);
    END LOOP;

    v_lucro := COALESCE(p_preco_final, 0) - v_custo_peca - v_custo_brindes;

    INSERT INTO sales (
        customer_name, customer_phone, customer_id, customer_cpf,
        product_id, product_name, product_size,
        preco_catalogo, desconto, sale_freight, preco_final,
        promotion_id, promotion_name, lucro, notes, quantity,
        custo_peca, custo_brindes
    ) VALUES (
        p_customer_name, p_customer_phone, p_customer_id, p_customer_cpf,
        p_product_id, p_product_name, v_size,
        p_preco_catalogo, p_desconto, p_sale_freight, p_preco_final,
        p_promotion_id, p_promotion_name, v_lucro, p_notes, v_qty,
        v_custo_peca, v_custo_brindes
    ) RETURNING id INTO v_sale_id;

    FOR v_gift IN SELECT * FROM jsonb_array_elements(COALESCE(p_gifts, '[]'::JSONB))
    LOOP
        v_gift_id := (v_gift->>'gift_id')::UUID;
        v_gift_name := COALESCE(v_gift->>'gift_name', 'Brinde');
        v_gift_qty := COALESCE((v_gift->>'quantity')::INTEGER, 1);
        INSERT INTO sale_gifts (sale_id, gift_id, gift_name, quantity)
        VALUES (v_sale_id, v_gift_id, v_gift_name, v_gift_qty);
        UPDATE gifts SET stock = stock - v_gift_qty, updated_at = NOW()
        WHERE id = v_gift_id;
    END LOOP;

    IF v_has_size_row THEN
        PERFORM adjust_product_stock(
            p_product_id, v_size, 'out_sale', v_qty,
            COALESCE(NULLIF(TRIM(p_notes), ''), 'Venda manual'),
            NULL, 'sale', v_sale_id, FALSE
        );
    ELSE
        UPDATE products SET stock = stock - v_qty, updated_at = NOW()
        WHERE id = p_product_id AND stock >= v_qty;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estoque do produto insuficiente';
        END IF;
    END IF;

    RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION register_sale(
    TEXT, TEXT, UUID, TEXT, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC,
    UUID, TEXT, NUMERIC, TEXT, JSONB, INTEGER, UUID, TEXT
) TO authenticated;

-- Cancelamento devolve estoque com histórico
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

    UPDATE sales
    SET cancelled_at = NOW()
    WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_sale TO authenticated;
