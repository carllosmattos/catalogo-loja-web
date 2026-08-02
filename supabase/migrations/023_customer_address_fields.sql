-- 023_customer_address_fields.sql
-- Endereço estruturado do cliente.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_zip TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_street TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_number TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_complement TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_neighborhood TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_city TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_state TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION _format_customer_address(
    p_street TEXT, p_number TEXT, p_complement TEXT,
    p_neighborhood TEXT, p_city TEXT, p_state TEXT, p_zip TEXT
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_line1 TEXT;
    v_line2 TEXT;
    v_zip TEXT;
BEGIN
    v_line1 := trim(COALESCE(p_street, ''));
    IF trim(COALESCE(p_number, '')) <> '' THEN
        v_line1 := v_line1 || CASE WHEN v_line1 <> '' THEN ', ' ELSE '' END || trim(p_number);
    END IF;
    IF trim(COALESCE(p_complement, '')) <> '' THEN
        v_line1 := v_line1 || CASE WHEN v_line1 <> '' THEN ' — ' ELSE '' END || trim(p_complement);
    END IF;
    v_line2 := trim(COALESCE(p_neighborhood, ''));
    IF trim(COALESCE(p_city, '')) <> '' THEN
        v_line2 := v_line2 || CASE WHEN v_line2 <> '' THEN ' — ' ELSE '' END || trim(p_city);
    END IF;
    IF trim(COALESCE(p_state, '')) <> '' THEN
        v_line2 := v_line2 || CASE WHEN v_line2 <> '' THEN '/' ELSE '' END || upper(trim(p_state));
    END IF;
    v_zip := regexp_replace(COALESCE(p_zip, ''), '\D', '', 'g');
    IF length(v_zip) = 8 THEN
        v_line2 := v_line2 || CASE WHEN v_line2 <> '' THEN ' — CEP ' ELSE 'CEP ' END
            || substring(v_zip from 1 for 5) || '-' || substring(v_zip from 6 for 3);
    ELSIF v_zip <> '' THEN
        v_line2 := v_line2 || CASE WHEN v_line2 <> '' THEN ' — CEP ' ELSE 'CEP ' END || v_zip;
    END IF;
    IF v_line1 <> '' AND v_line2 <> '' THEN
        RETURN v_line1 || E'\n' || v_line2;
    END IF;
    RETURN COALESCE(NULLIF(v_line1, ''), NULLIF(v_line2, ''), '');
END;
$$;

DROP FUNCTION IF EXISTS save_customer_profile(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION save_customer_profile(
    p_name TEXT,
    p_phone TEXT,
    p_cpf TEXT,
    p_address TEXT DEFAULT '',
    p_email TEXT DEFAULT '',
    p_address_zip TEXT DEFAULT '',
    p_address_street TEXT DEFAULT '',
    p_address_number TEXT DEFAULT '',
    p_address_complement TEXT DEFAULT '',
    p_address_neighborhood TEXT DEFAULT '',
    p_address_city TEXT DEFAULT '',
    p_address_state TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
    v_cpf TEXT;
    v_email TEXT;
    v_zip TEXT;
    v_state TEXT;
    v_formatted TEXT;
    v_row customers%ROWTYPE;
BEGIN
    v_phone := normalize_phone_br(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'));
    v_cpf := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
    v_email := lower(trim(COALESCE(p_email, '')));
    v_zip := regexp_replace(COALESCE(p_address_zip, ''), '\D', '', 'g');
    v_state := upper(trim(COALESCE(p_address_state, '')));

    IF length(v_phone) < 12 THEN
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

    v_formatted := _format_customer_address(
        p_address_street, p_address_number, p_address_complement,
        p_address_neighborhood, p_address_city, v_state, v_zip
    );
    IF v_formatted = '' THEN
        v_formatted := trim(COALESCE(p_address, ''));
    END IF;

    SELECT * INTO v_row FROM customers WHERE cpf = v_cpf LIMIT 1;

    IF FOUND THEN
        UPDATE customers SET
            name = trim(p_name),
            phone = v_phone,
            email = v_email,
            address = v_formatted,
            address_zip = v_zip,
            address_street = trim(COALESCE(p_address_street, '')),
            address_number = trim(COALESCE(p_address_number, '')),
            address_complement = trim(COALESCE(p_address_complement, '')),
            address_neighborhood = trim(COALESCE(p_address_neighborhood, '')),
            address_city = trim(COALESCE(p_address_city, '')),
            address_state = v_state,
            updated_at = NOW()
        WHERE id = v_row.id
        RETURNING * INTO v_row;
    ELSE
        SELECT * INTO v_row FROM customers
        WHERE normalize_phone_br(phone) = v_phone LIMIT 1;
        IF FOUND THEN
            UPDATE customers SET
                name = trim(p_name),
                cpf = v_cpf,
                email = v_email,
                address = v_formatted,
                address_zip = v_zip,
                address_street = trim(COALESCE(p_address_street, '')),
                address_number = trim(COALESCE(p_address_number, '')),
                address_complement = trim(COALESCE(p_address_complement, '')),
                address_neighborhood = trim(COALESCE(p_address_neighborhood, '')),
                address_city = trim(COALESCE(p_address_city, '')),
                address_state = v_state,
                updated_at = NOW()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
        ELSE
            INSERT INTO customers (
                name, phone, cpf, email, address, points,
                address_zip, address_street, address_number, address_complement,
                address_neighborhood, address_city, address_state
            ) VALUES (
                trim(p_name), v_phone, v_cpf, v_email, v_formatted, 0,
                v_zip, trim(COALESCE(p_address_street, '')),
                trim(COALESCE(p_address_number, '')),
                trim(COALESCE(p_address_complement, '')),
                trim(COALESCE(p_address_neighborhood, '')),
                trim(COALESCE(p_address_city, '')), v_state
            )
            RETURNING * INTO v_row;
        END IF;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION save_customer_profile(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
