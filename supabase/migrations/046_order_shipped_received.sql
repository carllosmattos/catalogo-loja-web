-- 046_order_shipped_received.sql
-- Status enviado/recebido, rastreio, shipping_method, e-mail shipped, lista paginada.

-- ── Colunas ───────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_method TEXT NOT NULL DEFAULT 'delivery'
    CHECK (shipping_method IN ('delivery', 'uber'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_label TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tracking_code TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tracking_url TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.shipping_method IS 'delivery = transportadora/correios; uber = sem rastreio no e-mail';
COMMENT ON COLUMN orders.tracking_code IS 'Código de rastreio externo (só delivery)';
COMMENT ON COLUMN orders.tracking_url IS 'URL de rastreio externo (só delivery)';

-- Inferência best-effort para pedidos antigos
UPDATE orders
SET shipping_method = 'uber',
    shipping_label = CASE
      WHEN trim(COALESCE(shipping_label, '')) = '' THEN 'Uber'
      ELSE shipping_label
    END
WHERE shipping_method = 'delivery'
  AND (
    lower(COALESCE(shipping_label, '')) LIKE '%uber%'
    OR lower(COALESCE(notes, '')) LIKE '%uber%'
  );

-- ── Status CHECK ─────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.orders'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'pending_payment', 'paid', 'shipped', 'received',
    'cancelled', 'canceled', 'expired',
    'refund_requested', 'awaiting_return', 'refunded'
  ));

-- ── order_email_log kinds ─────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.order_email_log'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE order_email_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE order_email_log
  ADD CONSTRAINT order_email_log_kind_check
  CHECK (kind IN ('paid', 'shipped'));

-- ── Marcar enviado (admin / service_role) ─────────────────
CREATE OR REPLACE FUNCTION mark_order_shipped(
  p_order_id UUID,
  p_tracking_code TEXT DEFAULT '',
  p_tracking_url TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_code TEXT;
  v_url TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Só é possível marcar como enviado pedidos pagos';
  END IF;

  v_code := trim(COALESCE(p_tracking_code, ''));
  v_url := trim(COALESCE(p_tracking_url, ''));

  IF v_order.shipping_method = 'uber' THEN
    v_code := '';
    v_url := '';
  END IF;

  UPDATE orders SET
    status = 'shipped',
    shipped_at = NOW(),
    tracking_code = v_code,
    tracking_url = v_url
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'shipping_method', v_order.shipping_method,
    'tracking_code', v_order.tracking_code,
    'tracking_url', v_order.tracking_url,
    'shipped_at', v_order.shipped_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION mark_order_shipped(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ── Cliente confirma recebimento ──────────────────────────
CREATE OR REPLACE FUNCTION mark_order_received(
  p_order_id UUID,
  p_customer_id UUID
) RETURNS JSONB
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
  IF v_order.status <> 'shipped' THEN
    RAISE EXCEPTION 'Só é possível confirmar recebimento de pedidos enviados';
  END IF;

  UPDATE orders SET
    status = 'received',
    received_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'received_at', v_order.received_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION mark_order_received(UUID, UUID) TO anon, authenticated, service_role;

-- ── Lista paginada de pedidos do cliente ──────────────────
DROP FUNCTION IF EXISTS list_orders_by_customer(UUID, INTEGER);

CREATE OR REPLACE FUNCTION list_orders_by_customer(
  p_customer_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_offset INTEGER;
  v_total INTEGER;
  v_items JSONB;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::JSONB, 'total', 0);
  END IF;

  v_limit := GREATEST(COALESCE(p_limit, 20), 1);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::INTEGER INTO v_total
  FROM orders o
  WHERE o.customer_id = p_customer_id
    AND o.customer_hidden_at IS NULL;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_at DESC), '[]'::JSONB)
  INTO v_items
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
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION list_orders_by_customer(UUID, INTEGER, INTEGER)
  TO anon, authenticated, service_role;

-- Reembolso ainda permitido em paid ou shipped (antes de confirmar recebimento)
DROP FUNCTION IF EXISTS request_order_refund(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS request_order_refund(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION request_order_refund(
    p_order_id UUID,
    p_customer_id UUID,
    p_reason TEXT DEFAULT '',
    p_reason_code TEXT DEFAULT 'other'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_payment_id UUID;
    v_refund_id UUID;
    v_short TEXT;
    v_link TEXT;
    v_code TEXT;
    v_code_label TEXT;
    v_reason_text TEXT;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Pedido não pertence ao cliente';
    END IF;
    IF v_order.status NOT IN ('paid', 'shipped') THEN
        RAISE EXCEPTION 'Reembolso só para pedidos pagos ou enviados';
    END IF;

    v_code := lower(trim(COALESCE(p_reason_code, 'other')));
    IF v_code NOT IN ('cooling_off', 'defect', 'other') THEN
        v_code := 'other';
    END IF;
    v_code_label := CASE v_code
      WHEN 'cooling_off' THEN 'Direito de arrependimento (7 dias)'
      WHEN 'defect' THEN 'Produto com defeito / errado / avariado'
      ELSE 'Outro motivo'
    END;
    v_reason_text := trim(COALESCE(p_reason, ''));

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND status = 'approved'
    ORDER BY created_at DESC LIMIT 1;

    IF EXISTS (
        SELECT 1 FROM refund_requests
        WHERE order_id = p_order_id AND status IN ('pending', 'approved')
    ) THEN
        RAISE EXCEPTION 'Já existe solicitação de reembolso em andamento';
    END IF;

    INSERT INTO refund_requests (
      order_id, payment_id, reason, reason_code, reason_detail, status
    ) VALUES (
      p_order_id,
      v_payment_id,
      v_code_label || CASE WHEN v_reason_text <> '' THEN ': ' || v_reason_text ELSE '' END,
      v_code,
      v_reason_text,
      'pending'
    )
    RETURNING id INTO v_refund_id;

    UPDATE orders SET status = 'awaiting_return' WHERE id = p_order_id;

    v_short := LEFT(p_order_id::TEXT, 8);
    v_link := CASE
      WHEN v_order.tracking_token IS NOT NULL THEN '/pedidos/' || v_order.tracking_token::TEXT
      ELSE '/pedidos'
    END;

    PERFORM create_notification(
      'admin',
      NULL,
      'refund_requested',
      'Reembolso — aguardando devolução',
      COALESCE(NULLIF(trim(v_order.customer_name), ''), 'Cliente')
        || ' · pedido #' || v_short
        || E'\n' || v_code_label
        || CASE WHEN v_reason_text <> '' THEN E'\n' || v_reason_text ELSE '' END
        || E'\nAprove só após receber e conferir a peça.',
      '/admin/reembolsos',
      jsonb_build_object(
        'order_id', p_order_id,
        'refund_id', v_refund_id,
        'customer_id', p_customer_id,
        'reason_code', v_code
      )
    );

    PERFORM create_notification(
      'customer',
      p_customer_id,
      'refund_requested',
      'Solicitação recebida — envie a peça de volta',
      'Pedido #' || v_short || '. O estorno só ocorre após a loja receber e conferir o produto. '
        || 'Consulte Trocas e devoluções. Frete de devolução por sua conta '
        || '(exceto defeito/erro da loja).',
      v_link,
      jsonb_build_object('order_id', p_order_id, 'refund_id', v_refund_id, 'reason_code', v_code)
    );

    RETURN v_refund_id;
END;
$$;

GRANT EXECUTE ON FUNCTION request_order_refund(UUID, UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;
