-- 044_refund_awaiting_return_and_reason.sql
-- Motivo tipado + status aguardando devolução + confirmação de recebimento.

-- ── Colunas em refund_requests ────────────────────────────
ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS reason_code TEXT NOT NULL DEFAULT 'other'
    CHECK (reason_code IN ('cooling_off', 'defect', 'other'));

ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS reason_detail TEXT NOT NULL DEFAULT '';

ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS product_received_at TIMESTAMPTZ;

ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS product_received_by UUID;

-- Pedidos: novo status awaiting_return
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
    'pending_payment', 'paid', 'cancelled', 'canceled', 'expired',
    'refund_requested', 'awaiting_return', 'refunded'
  ));

-- Migra solicitações abertas para o novo status
UPDATE orders
SET status = 'awaiting_return'
WHERE status = 'refund_requested';

-- ── Solicitar reembolso ───────────────────────────────────
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
    IF v_order.status <> 'paid' THEN
        RAISE EXCEPTION 'Reembolso só para pedidos pagos';
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

-- Uma assinatura com defaults (reason + reason_code)
GRANT EXECUTE ON FUNCTION request_order_refund(UUID, UUID, TEXT, TEXT)
  TO anon, authenticated;

-- Rejeitar
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
  v_link TEXT;
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

  UPDATE orders SET status = 'paid'
  WHERE id = v_req.order_id
    AND status IN ('awaiting_return', 'refund_requested');

  PERFORM mark_admin_notifications_read_by_meta('refund_requested', v_req.order_id);

  SELECT * INTO v_order FROM orders WHERE id = v_req.order_id;
  IF FOUND AND v_order.customer_id IS NOT NULL THEN
    v_short := LEFT(v_req.order_id::TEXT, 8);
    v_link := CASE
      WHEN v_order.tracking_token IS NOT NULL THEN '/pedidos/' || v_order.tracking_token::TEXT
      ELSE '/pedidos'
    END;
    PERFORM create_notification(
      'customer',
      v_order.customer_id,
      'refund_rejected',
      'Reembolso não aprovado',
      'Pedido #' || v_short
        || CASE WHEN NULLIF(trim(COALESCE(p_admin_notes, '')), '') IS NOT NULL
             THEN E'\n' || trim(p_admin_notes) ELSE '' END,
      v_link,
      jsonb_build_object('order_id', v_req.order_id, 'refund_id', p_refund_id)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_order_refund(UUID, TEXT) TO authenticated;

-- mark_order_refunded exige confirmação de recebimento da peça
DROP FUNCTION IF EXISTS mark_order_refunded(UUID);
DROP FUNCTION IF EXISTS mark_order_refunded(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION mark_order_refunded(
  p_order_id UUID,
  p_product_received BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale RECORD;
    v_order orders%ROWTYPE;
    v_short TEXT;
    v_link TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated'
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    IF NOT COALESCE(p_product_received, false) THEN
        RAISE EXCEPTION 'Confirme o recebimento e conferência do produto antes de aprovar o reembolso';
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
        processed_at = NOW(),
        product_received_at = COALESCE(product_received_at, NOW())
    WHERE order_id = p_order_id
      AND status IN ('approved', 'pending');

    PERFORM mark_admin_notifications_read_by_meta('refund_requested', p_order_id);

    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF FOUND AND v_order.customer_id IS NOT NULL THEN
      v_short := LEFT(p_order_id::TEXT, 8);
      v_link := CASE
        WHEN v_order.tracking_token IS NOT NULL THEN '/pedidos/' || v_order.tracking_token::TEXT
        ELSE '/pedidos'
      END;
      PERFORM create_notification(
        'customer',
        v_order.customer_id,
        'refund_approved',
        'Reembolso aprovado',
        'Pedido #' || v_short || ' — peça conferida. O valor será estornado conforme o Mercado Pago.',
        v_link,
        jsonb_build_object('order_id', p_order_id)
      );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_order_refunded(UUID, BOOLEAN) TO authenticated;

-- Trigger: não re-notificar paid ao rejeitar (awaiting_return → paid)
CREATE OR REPLACE FUNCTION notify_on_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_short TEXT;
  v_token TEXT;
  v_link TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_short := LEFT(NEW.id::TEXT, 8);
  v_token := CASE WHEN NEW.tracking_token IS NOT NULL THEN NEW.tracking_token::TEXT ELSE '' END;
  v_link := CASE WHEN v_token <> '' THEN '/pedidos/' || v_token ELSE '/pedidos' END;

  IF NEW.status = 'paid'
     AND OLD.status IS DISTINCT FROM 'paid'
     AND OLD.status NOT IN ('refund_requested', 'awaiting_return') THEN
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
        v_link,
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
        v_link,
        jsonb_build_object('order_id', NEW.id)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
