-- 015_customer_email.sql
-- E-mail do cliente (obrigatório para Mercado Pago)

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)
    WHERE email <> '';

DROP FUNCTION IF EXISTS save_customer_profile(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION save_customer_profile(
    p_name TEXT,
    p_phone TEXT,
    p_cpf TEXT,
    p_address TEXT DEFAULT '',
    p_email TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
    v_cpf TEXT;
    v_email TEXT;
    v_row customers%ROWTYPE;
BEGIN
    v_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_cpf := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
    v_email := lower(trim(COALESCE(p_email, '')));

    IF length(v_phone) < 10 THEN
        RAISE EXCEPTION 'Telefone inválido';
    END IF;
    IF length(v_cpf) <> 11 THEN
        RAISE EXCEPTION 'CPF inválido';
    END IF;
    IF trim(COALESCE(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Nome obrigatório';
    END IF;
    IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'E-mail inválido';
    END IF;

    SELECT * INTO v_row FROM customers WHERE cpf = v_cpf LIMIT 1;

    IF FOUND THEN
        UPDATE customers SET
            name = trim(p_name),
            phone = v_phone,
            email = v_email,
            address = COALESCE(p_address, ''),
            updated_at = NOW()
        WHERE id = v_row.id
        RETURNING * INTO v_row;
    ELSE
        SELECT * INTO v_row FROM customers WHERE phone = v_phone LIMIT 1;
        IF FOUND THEN
            UPDATE customers SET
                name = trim(p_name),
                cpf = v_cpf,
                email = v_email,
                address = COALESCE(p_address, ''),
                updated_at = NOW()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
        ELSE
            INSERT INTO customers (name, phone, cpf, email, address, points)
            VALUES (trim(p_name), v_phone, v_cpf, v_email, COALESCE(p_address, ''), 0)
            RETURNING * INTO v_row;
        END IF;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION save_customer_profile(TEXT, TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated;
