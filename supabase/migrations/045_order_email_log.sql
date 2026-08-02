-- Idempotência de e-mails transacionais (pagamento aprovado, etc.)

CREATE TABLE IF NOT EXISTS order_email_log (
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('paid')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_order_email_log_sent_at
  ON order_email_log (sent_at DESC);

ALTER TABLE order_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_email_log_auth_all ON order_email_log;
CREATE POLICY order_email_log_auth_all ON order_email_log
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE order_email_log IS
  'Registro de e-mails enviados por pedido; PK (order_id, kind) evita duplicata.';
