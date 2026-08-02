-- 042_featured_products_and_notifications.sql
-- Destaques no produto + sistema de notificações (admin/cliente) + reembolso.

-- ── Destaques ───────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_featured
  ON products (featured_at DESC NULLS LAST)
  WHERE is_featured = true AND active = true;

-- ── Notificações ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience TEXT NOT NULL CHECK (audience IN ('admin', 'customer')),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_customer_audience CHECK (
    (audience = 'admin' AND customer_id IS NULL)
    OR (audience = 'customer' AND customer_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_notifications_admin_unread
  ON notifications (created_at DESC)
  WHERE audience = 'admin' AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_admin_all
  ON notifications (created_at DESC)
  WHERE audience = 'admin';

CREATE INDEX IF NOT EXISTS idx_notifications_customer
  ON notifications (customer_id, created_at DESC)
  WHERE audience = 'customer';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_auth_all ON notifications;
CREATE POLICY notifications_auth_all ON notifications
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Helper: cria notificação (security definer)
CREATE OR REPLACE FUNCTION create_notification(
  p_audience TEXT,
  p_customer_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT DEFAULT '',
  p_link TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_audience NOT IN ('admin', 'customer') THEN
    RAISE EXCEPTION 'audience inválida';
  END IF;
  IF p_audience = 'admin' THEN
    p_customer_id := NULL;
  ELSIF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id obrigatório para notificação do cliente';
  END IF;

  INSERT INTO notifications (audience, customer_id, type, title, body, link, meta)
  VALUES (
    p_audience,
    p_customer_id,
    COALESCE(NULLIF(trim(p_type), ''), 'info'),
    COALESCE(NULLIF(trim(p_title), ''), 'Aviso'),
    COALESCE(p_body, ''),
    p_link,
    COALESCE(p_meta, '{}'::JSONB)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_notification(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO anon, authenticated, service_role;

-- Marca como lidas notificações admin de um pedido/tipo
CREATE OR REPLACE FUNCTION mark_admin_notifications_read_by_meta(
  p_type TEXT,
  p_order_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE audience = 'admin'
    AND read_at IS NULL
    AND type = p_type
    AND (meta->>'order_id') = p_order_id::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_admin_notifications_read_by_meta(TEXT, UUID)
  TO authenticated, service_role;

-- Lista / contagem / marcar lida (cliente via RPC)
CREATE OR REPLACE FUNCTION list_customer_notifications(
  p_customer_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id obrigatório';
  END IF;
  RETURN QUERY
  SELECT n.*
  FROM notifications n
  WHERE n.audience = 'customer'
    AND n.customer_id = p_customer_id
  ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION list_customer_notifications(UUID, INT, INT)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION count_unread_customer_notifications(p_customer_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM notifications
  WHERE audience = 'customer'
    AND customer_id = p_customer_id
    AND read_at IS NULL;
  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION count_unread_customer_notifications(UUID)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION mark_customer_notification_read(
  p_notification_id UUID,
  p_customer_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE id = p_notification_id
    AND audience = 'customer'
    AND customer_id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_customer_notification_read(UUID, UUID)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION mark_all_customer_notifications_read(p_customer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE audience = 'customer'
    AND customer_id = p_customer_id
    AND read_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_all_customer_notifications_read(UUID)
  TO anon, authenticated;

-- Admin list helpers (authenticated)
CREATE OR REPLACE FUNCTION list_admin_notifications(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  RETURN QUERY
  SELECT n.*
  FROM notifications n
  WHERE n.audience = 'admin'
  ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION list_admin_notifications(INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION count_unread_admin_notifications()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM notifications
  WHERE audience = 'admin' AND read_at IS NULL;
  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION count_unread_admin_notifications() TO authenticated;

CREATE OR REPLACE FUNCTION mark_admin_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE id = p_notification_id AND audience = 'admin';
END;
$$;

GRANT EXECUTE ON FUNCTION mark_admin_notification_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION mark_all_admin_notifications_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  UPDATE notifications
  SET read_at = COALESCE(read_at, NOW())
  WHERE audience = 'admin' AND read_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_all_admin_notifications_read() TO authenticated;

-- ── Reembolso: notifica ao solicitar ──────────────────────
CREATE OR REPLACE FUNCTION request_order_refund(
    p_order_id UUID,
    p_customer_id UUID,
    p_reason TEXT DEFAULT ''
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
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado';
    END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Pedido não pertence ao cliente';
    END IF;
    IF v_order.status <> 'paid' THEN
        RAISE EXCEPTION 'Reembolso só para pedidos pagos';
    END IF;

    SELECT id INTO v_payment_id FROM payments
    WHERE order_id = p_order_id AND status = 'approved'
    ORDER BY created_at DESC LIMIT 1;

    IF EXISTS (
        SELECT 1 FROM refund_requests
        WHERE order_id = p_order_id AND status IN ('pending', 'approved')
    ) THEN
        RAISE EXCEPTION 'Já existe solicitação de reembolso em andamento';
    END IF;

    INSERT INTO refund_requests (order_id, payment_id, reason, status)
    VALUES (p_order_id, v_payment_id, COALESCE(p_reason, ''), 'pending')
    RETURNING id INTO v_refund_id;

    UPDATE orders SET status = 'refund_requested' WHERE id = p_order_id;

    v_short := LEFT(p_order_id::TEXT, 8);

    PERFORM create_notification(
      'admin',
      NULL,
      'refund_requested',
      'Reembolso solicitado',
      COALESCE(NULLIF(trim(v_order.customer_name), ''), 'Cliente')
        || ' pediu reembolso do pedido #' || v_short
        || CASE WHEN NULLIF(trim(COALESCE(p_reason, '')), '') IS NOT NULL
             THEN E'\nMotivo: ' || trim(p_reason) ELSE '' END,
      '/admin/pagamentos?order=' || p_order_id::TEXT,
      jsonb_build_object(
        'order_id', p_order_id,
        'refund_id', v_refund_id,
        'customer_id', p_customer_id
      )
    );

    PERFORM create_notification(
      'customer',
      p_customer_id,
      'refund_requested',
      'Recebemos sua solicitação de reembolso',
      'Pedido #' || v_short || ' — vamos analisar em breve.',
      '/pedidos/' || COALESCE(v_order.tracking_token, ''),
      jsonb_build_object('order_id', p_order_id, 'refund_id', v_refund_id)
    );

    RETURN v_refund_id;
END;
$$;

GRANT EXECUTE ON FUNCTION request_order_refund(UUID, UUID, TEXT) TO anon, authenticated;

-- Rejeitar reembolso (admin)
CREATE OR REPLACE FUNCTION reject_order_refund(
  p_refund_id UUID,
  p_admin_notes TEXT DEFAULT ''
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req refund_requests%ROWTYPE;
  v_order orders%ROWTYPE;
  v_short TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  SELECT * INTO v_req FROM refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Solicitação já foi tratada';
  END IF;

  UPDATE refund_requests
  SET status = 'rejected',
      admin_notes = COALESCE(p_admin_notes, ''),
      processed_at = NOW()
  WHERE id = p_refund_id;

  UPDATE orders SET status = 'paid' WHERE id = v_req.order_id;

  PERFORM mark_admin_notifications_read_by_meta('refund_requested', v_req.order_id);

  SELECT * INTO v_order FROM orders WHERE id = v_req.order_id;
  IF FOUND AND v_order.customer_id IS NOT NULL THEN
    v_short := LEFT(v_req.order_id::TEXT, 8);
    PERFORM create_notification(
      'customer',
      v_order.customer_id,
      'refund_rejected',
      'Reembolso não aprovado',
      'Pedido #' || v_short
        || CASE WHEN NULLIF(trim(COALESCE(p_admin_notes, '')), '') IS NOT NULL
             THEN E'\n' || trim(p_admin_notes) ELSE '' END,
      '/pedidos/' || COALESCE(v_order.tracking_token, ''),
      jsonb_build_object('order_id', v_req.order_id, 'refund_id', p_refund_id)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_order_refund(UUID, TEXT) TO authenticated;

-- Após marcar reembolsado: notifica cliente + limpa admin
CREATE OR REPLACE FUNCTION mark_order_refunded(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale RECORD;
    v_order orders%ROWTYPE;
    v_short TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated'
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    UPDATE orders SET status = 'refunded' WHERE id = p_order_id;
    UPDATE payments SET status = 'refunded', updated_at = NOW()
    WHERE order_id = p_order_id;

    FOR v_sale IN
        SELECT id FROM sales WHERE order_id = p_order_id AND cancelled_at IS NULL
    LOOP
        PERFORM cancel_sale(v_sale.id);
    END LOOP;

    UPDATE refund_requests
    SET status = 'processed',
        processed_at = NOW()
    WHERE order_id = p_order_id
      AND status IN ('approved', 'pending');

    PERFORM mark_admin_notifications_read_by_meta('refund_requested', p_order_id);

    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF FOUND AND v_order.customer_id IS NOT NULL THEN
      v_short := LEFT(p_order_id::TEXT, 8);
      PERFORM create_notification(
        'customer',
        v_order.customer_id,
        'refund_approved',
        'Reembolso aprovado',
        'Pedido #' || v_short || ' — o valor será estornado conforme o Mercado Pago.',
        '/pedidos/' || COALESCE(v_order.tracking_token, ''),
        jsonb_build_object('order_id', p_order_id)
      );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_order_refunded(UUID) TO authenticated;

-- ── Triggers: pedido pago / cancelado ─────────────────────
CREATE OR REPLACE FUNCTION notify_on_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_short TEXT;
  v_token TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_short := LEFT(NEW.id::TEXT, 8);
  v_token := COALESCE(NEW.tracking_token, '');

  -- Evita re-notificar quando admin rejeita reembolso (refund_requested → paid)
  IF NEW.status = 'paid'
     AND OLD.status IS DISTINCT FROM 'paid'
     AND OLD.status IS DISTINCT FROM 'refund_requested' THEN
    PERFORM create_notification(
      'admin',
      NULL,
      'order_paid',
      'Novo pedido pago',
      COALESCE(NULLIF(trim(NEW.customer_name), ''), 'Cliente')
        || ' — pedido #' || v_short
        || ' · R$ ' || to_char(COALESCE(NEW.total_amount, 0), 'FM999999990.00'),
      '/admin/pagamentos?order=' || NEW.id::TEXT,
      jsonb_build_object('order_id', NEW.id, 'customer_id', NEW.customer_id)
    );
    IF NEW.customer_id IS NOT NULL THEN
      PERFORM create_notification(
        'customer',
        NEW.customer_id,
        'order_paid',
        'Pagamento confirmado',
        'Pedido #' || v_short || ' foi pago com sucesso.',
        '/pedidos/' || v_token,
        jsonb_build_object('order_id', NEW.id)
      );
    END IF;
  ELSIF NEW.status IN ('cancelled', 'canceled', 'expired')
        AND OLD.status NOT IN ('cancelled', 'canceled', 'expired') THEN
    PERFORM create_notification(
      'admin',
      NULL,
      'order_cancelled',
      'Pedido cancelado',
      'Pedido #' || v_short || ' · status ' || NEW.status,
      '/admin/pagamentos?order=' || NEW.id::TEXT,
      jsonb_build_object('order_id', NEW.id, 'customer_id', NEW.customer_id)
    );
    IF NEW.customer_id IS NOT NULL THEN
      PERFORM create_notification(
        'customer',
        NEW.customer_id,
        'order_cancelled',
        'Pedido cancelado',
        'Pedido #' || v_short || ' foi cancelado. Você pode gerar um novo PIX se quiser.',
        '/pedidos/' || v_token,
        jsonb_build_object('order_id', NEW.id)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order_status ON orders;
CREATE TRIGGER trg_notify_order_status
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_order_status_change();

-- Estoque zerou / baixo (product_sizes)
CREATE OR REPLACE FUNCTION notify_on_stock_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_total INT;
  v_prev_total INT;
BEGIN
  SELECT COALESCE(SUM(stock), 0) INTO v_total
  FROM product_sizes WHERE product_id = NEW.product_id;

  IF TG_OP = 'UPDATE' THEN
    v_prev_total := v_total - COALESCE(NEW.stock, 0) + COALESCE(OLD.stock, 0);
  ELSE
    v_prev_total := v_total - COALESCE(NEW.stock, 0);
  END IF;

  SELECT name INTO v_name FROM products WHERE id = NEW.product_id;

  IF v_total <= 0 AND v_prev_total > 0 THEN
    PERFORM create_notification(
      'admin',
      NULL,
      'stock_out',
      'Produto esgotado',
      COALESCE(v_name, 'Produto') || ' ficou sem estoque.',
      '/admin/produtos/cadastro?edit=' || NEW.product_id::TEXT,
      jsonb_build_object('product_id', NEW.product_id)
    );
  ELSIF v_total > 0 AND v_total <= 2 AND v_prev_total > 2 THEN
    PERFORM create_notification(
      'admin',
      NULL,
      'stock_low',
      'Estoque baixo',
      COALESCE(v_name, 'Produto') || ' com apenas ' || v_total::TEXT || ' un.',
      '/admin/produtos/cadastro?edit=' || NEW.product_id::TEXT,
      jsonb_build_object('product_id', NEW.product_id, 'stock', v_total)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_stock ON product_sizes;
CREATE TRIGGER trg_notify_stock
  AFTER INSERT OR UPDATE OF stock ON product_sizes
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_stock_change();

-- Cupom esgotou usos
CREATE OR REPLACE FUNCTION notify_on_coupon_exhausted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.max_uses IS NOT NULL
     AND NEW.used_count IS NOT NULL
     AND NEW.used_count >= NEW.max_uses
     AND (OLD.used_count IS NULL OR OLD.used_count < OLD.max_uses
          OR OLD.max_uses IS DISTINCT FROM NEW.max_uses) THEN
    PERFORM create_notification(
      'admin',
      NULL,
      'coupon_exhausted',
      'Cupom sem usos',
      'Cupom ' || COALESCE(NEW.code, '') || ' atingiu o limite de usos.',
      '/admin/cupons',
      jsonb_build_object('coupon_id', NEW.id, 'code', NEW.code)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_coupon ON coupons;
CREATE TRIGGER trg_notify_coupon
  AFTER UPDATE OF used_count, max_uses ON coupons
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_coupon_exhausted();
