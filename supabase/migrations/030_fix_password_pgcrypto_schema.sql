-- 030_fix_password_pgcrypto_schema.sql
-- No Supabase, pgcrypto fica em extensions; funções com search_path=public
-- não enxergam gen_salt/crypt sem schema qualificado.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION register_customer_account(
    p_email TEXT,
    p_password TEXT,
    p_phone TEXT DEFAULT '',
    p_name TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_email TEXT := lower(trim(COALESCE(p_email, '')));
    v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_row customers%ROWTYPE;
BEGIN
    IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Informe um e-mail válido';
    END IF;
    IF length(COALESCE(p_password, '')) < 6 THEN
        RAISE EXCEPTION 'Senha deve ter no mínimo 6 caracteres';
    END IF;

    SELECT * INTO v_row FROM customers WHERE lower(email) = v_email LIMIT 1;
    IF FOUND THEN
        IF v_row.password_hash IS NOT NULL AND v_row.password_hash <> '' THEN
            RAISE EXCEPTION 'Já existe conta com este e-mail. Faça login.';
        END IF;
        UPDATE customers
        SET
            password_hash = crypt(p_password, gen_salt('bf')),
            phone = CASE WHEN v_phone <> '' THEN v_phone ELSE phone END,
            name = CASE WHEN trim(COALESCE(p_name, '')) <> '' THEN trim(p_name) ELSE name END,
            updated_at = NOW()
        WHERE id = v_row.id
        RETURNING * INTO v_row;
        RETURN customer_public_json(v_row);
    END IF;

    IF v_phone <> '' THEN
        SELECT * INTO v_row FROM customers WHERE phone = v_phone LIMIT 1;
        IF FOUND THEN
            UPDATE customers
            SET
                email = v_email,
                password_hash = crypt(p_password, gen_salt('bf')),
                name = CASE WHEN trim(COALESCE(p_name, '')) <> '' THEN trim(p_name) ELSE name END,
                updated_at = NOW()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
            RETURN customer_public_json(v_row);
        END IF;
    END IF;

    INSERT INTO customers (name, phone, email, password_hash, points, cpf)
    VALUES (
        trim(COALESCE(p_name, '')),
        v_phone,
        v_email,
        crypt(p_password, gen_salt('bf')),
        0,
        ''
    )
    RETURNING * INTO v_row;

    RETURN customer_public_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION login_customer_account(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_email TEXT := lower(trim(COALESCE(p_email, '')));
    v_row customers%ROWTYPE;
BEGIN
    IF v_email = '' OR COALESCE(p_password, '') = '' THEN
        RAISE EXCEPTION 'Informe e-mail e senha';
    END IF;

    SELECT * INTO v_row
    FROM customers
    WHERE lower(email) = v_email
    LIMIT 1;

    IF NOT FOUND OR v_row.password_hash IS NULL OR v_row.password_hash = '' THEN
        RAISE EXCEPTION 'E-mail ou senha inválidos';
    END IF;

    IF v_row.password_hash <> crypt(p_password, v_row.password_hash) THEN
        RAISE EXCEPTION 'E-mail ou senha inválidos';
    END IF;

    RETURN customer_public_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION register_customer_account(TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION login_customer_account(TEXT, TEXT)
    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
