-- 009_customer_address.sql
-- Endereço do cliente + acesso público por telefone (RPC)

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';

-- Busca cliente pelo telefone (catálogo público, anon)
CREATE OR REPLACE FUNCTION lookup_customer_by_phone(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
    v_row customers%ROWTYPE;
BEGIN
    v_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    IF length(v_phone) < 10 THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_row
    FROM customers
    WHERE phone = v_phone
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_customer_by_phone TO anon, authenticated;

-- Cadastro/atualização pelo catálogo (anon)
CREATE OR REPLACE FUNCTION save_customer_profile(
    p_name TEXT,
    p_phone TEXT,
    p_cpf TEXT,
    p_address TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
    v_cpf TEXT;
    v_row customers%ROWTYPE;
BEGIN
    v_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_cpf := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');

    IF length(v_phone) < 10 THEN
        RAISE EXCEPTION 'Telefone inválido';
    END IF;
    IF length(v_cpf) <> 11 THEN
        RAISE EXCEPTION 'CPF inválido';
    END IF;
    IF trim(COALESCE(p_name, '')) = '' THEN
        RAISE EXCEPTION 'Nome obrigatório';
    END IF;

    SELECT * INTO v_row FROM customers WHERE cpf = v_cpf LIMIT 1;

    IF FOUND THEN
        UPDATE customers SET
            name = trim(p_name),
            phone = v_phone,
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
                address = COALESCE(p_address, ''),
                updated_at = NOW()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
        ELSE
            INSERT INTO customers (name, phone, cpf, address, points)
            VALUES (trim(p_name), v_phone, v_cpf, COALESCE(p_address, ''), 0)
            RETURNING * INTO v_row;
        END IF;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION save_customer_profile TO anon, authenticated;
