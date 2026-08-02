-- 028_melhor_envio_oauth.sql
-- Credenciais OAuth Melhor Envio (acesso só via service_role no app).

CREATE TABLE IF NOT EXISTS melhor_envio_credentials (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ,
    scope TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO melhor_envio_credentials (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE melhor_envio_credentials ENABLE ROW LEVEL SECURITY;

-- Sem policies para anon/authenticated — só service_role bypassa RLS.
DROP POLICY IF EXISTS melhor_envio_credentials_deny_all ON melhor_envio_credentials;
