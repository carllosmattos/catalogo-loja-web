-- 029_coupons_auth_dispatch.sql
-- Cupons, login e-mail/senha do cliente, desconto no pedido e dias de coleta/envio.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Cliente: senha + vínculo auth opcional ───────────────────
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Permite cadastro com senha antes de completar CPF
ALTER TABLE customers ALTER COLUMN cpf DROP NOT NULL;
ALTER TABLE customers ALTER COLUMN cpf SET DEFAULT '';

-- CPF único só quando preenchido
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customers_cpf_key' AND conrelid = 'customers'::regclass
    ) THEN
        ALTER TABLE customers DROP CONSTRAINT customers_cpf_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_cpf_unique_filled
    ON customers (cpf)
    WHERE cpf IS NOT NULL AND btrim(cpf) <> '';

CREATE INDEX IF NOT EXISTS idx_customers_auth_user ON customers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_customers_email_lower ON customers (lower(email));

-- Desconto de cupom no pedido
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ── Dias de envio (0=dom … 6=sáb), JSON array ────────────────
ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS shipping_dispatch_weekdays JSONB NOT NULL DEFAULT '[]'::JSONB;

-- ── Cupons ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    image_url TEXT DEFAULT '',
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT coupons_code_unique UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_code_active ON coupons (code) WHERE active = true;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer ON coupon_redemptions(customer_id);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupons_auth_all ON coupons;
CREATE POLICY coupons_auth_all ON coupons
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS coupons_public_read_active ON coupons;
CREATE POLICY coupons_public_read_active ON coupons
    FOR SELECT USING (active = true);

DROP POLICY IF EXISTS coupon_redemptions_auth_all ON coupon_redemptions;
CREATE POLICY coupon_redemptions_auth_all ON coupon_redemptions
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Normaliza código
CREATE OR REPLACE FUNCTION normalize_coupon_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT upper(regexp_replace(trim(COALESCE(p_code, '')), '\s+', '', 'g'));
$$;

-- Valida cupom (não consome uso)
CREATE OR REPLACE FUNCTION validate_coupon(
    p_code TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_subtotal NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_coupon_code(p_code);
    v_c coupons%ROWTYPE;
    v_discount NUMERIC;
BEGIN
    IF v_code = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Informe o código do cupom');
    END IF;

    SELECT * INTO v_c FROM coupons WHERE code = v_code LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom inválido');
    END IF;
    IF NOT v_c.active THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom inválido ou expirado');
    END IF;
    IF v_c.used_count >= v_c.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom esgotado');
    END IF;

    IF p_customer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM coupon_redemptions
        WHERE coupon_id = v_c.id AND customer_id = p_customer_id
        LIMIT 1
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Você já usou este cupom');
    END IF;

    IF v_c.discount_type = 'percent' THEN
        v_discount := ROUND(GREATEST(p_subtotal, 0) * (v_c.discount_value / 100.0), 2);
    ELSE
        v_discount := LEAST(v_c.discount_value, GREATEST(p_subtotal, 0));
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'coupon_id', v_c.id,
        'code', v_c.code,
        'title', v_c.title,
        'discount_type', v_c.discount_type,
        'discount_value', v_c.discount_value,
        'discount_amount', v_discount,
        'image_url', COALESCE(v_c.image_url, '')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_coupon(TEXT, UUID, NUMERIC) TO anon, authenticated, service_role;

-- Consome 1 uso do cupom (idempotente por pedido)
CREATE OR REPLACE FUNCTION redeem_coupon(
    p_code TEXT,
    p_customer_id UUID,
    p_order_id UUID,
    p_discount_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_coupon_code(p_code);
    v_c coupons%ROWTYPE;
BEGIN
    IF v_code = '' OR p_order_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Dados inválidos');
    END IF;

    SELECT * INTO v_c FROM coupons WHERE code = v_code FOR UPDATE;
    IF NOT FOUND OR NOT v_c.active OR v_c.used_count >= v_c.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom indisponível');
    END IF;

    IF EXISTS (SELECT 1 FROM coupon_redemptions WHERE order_id = p_order_id LIMIT 1) THEN
        RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;

    IF p_customer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM coupon_redemptions
        WHERE coupon_id = v_c.id AND customer_id = p_customer_id
        LIMIT 1
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cupom já utilizado');
    END IF;

    UPDATE coupons
    SET used_count = used_count + 1, updated_at = NOW()
    WHERE id = v_c.id;

    INSERT INTO coupon_redemptions (coupon_id, customer_id, order_id, discount_amount)
    VALUES (v_c.id, p_customer_id, p_order_id, GREATEST(COALESCE(p_discount_amount, 0), 0));

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_coupon(TEXT, UUID, UUID, NUMERIC) TO anon, authenticated, service_role;

-- Remove password_hash do JSON público do cliente
CREATE OR REPLACE FUNCTION customer_public_json(p_row customers)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT (to_jsonb(p_row) - 'password_hash');
$$;

-- Cadastro / define senha (e-mail + senha)
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

GRANT EXECUTE ON FUNCTION register_customer_account(TEXT, TEXT, TEXT, TEXT)
    TO anon, authenticated, service_role;

-- Login e-mail + senha
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

GRANT EXECUTE ON FUNCTION login_customer_account(TEXT, TEXT)
    TO anon, authenticated, service_role;

-- Checkout com desconto de cupom
DROP FUNCTION IF EXISTS create_checkout_order(UUID, JSONB, NUMERIC);

CREATE OR REPLACE FUNCTION create_checkout_order(
    p_customer_id UUID,
    p_items JSONB,
    p_shipping_amount NUMERIC DEFAULT 0,
    p_discount_amount NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer customers%ROWTYPE;
    v_order_id UUID;
    v_tracking UUID;
    v_total NUMERIC(10,2) := 0;
    v_shipping NUMERIC(10,2);
    v_discount NUMERIC(10,2);
    v_item JSONB;
    v_email TEXT;
    v_expires TIMESTAMPTZ;
    v_active INTEGER;
BEGIN
    PERFORM expire_stale_orders();

    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cliente não informado';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) < 1 THEN
        RAISE EXCEPTION 'Pedido sem itens';
    END IF;

    v_shipping := GREATEST(COALESCE(p_shipping_amount, 0), 0);
    v_discount := GREATEST(COALESCE(p_discount_amount, 0), 0);

    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado';
    END IF;

    v_email := lower(trim(COALESCE(v_customer.email, '')));
    IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Cadastre um e-mail válido em Minha conta';
    END IF;

    SELECT COUNT(*) INTO v_active
    FROM orders
    WHERE customer_id = p_customer_id
      AND status = 'pending_payment'
      AND (expires_at IS NULL OR expires_at > NOW());

    IF v_active > 0 THEN
        RAISE EXCEPTION 'Você já tem um pedido aguardando PIX. Conclua ou cancele em Minhas compras.';
    END IF;

    PERFORM _check_order_items_stock(p_items);

    v_tracking := gen_random_uuid();
    v_expires := NOW() + INTERVAL '15 minutes';

    INSERT INTO orders (
        customer_id, customer_name, customer_phone, customer_cpf, customer_email,
        status, total_amount, tracking_token, expires_at, shipping_amount, discount_amount
    ) VALUES (
        v_customer.id, v_customer.name, v_customer.phone, v_customer.cpf, v_email,
        'pending_payment', 0, v_tracking, v_expires, v_shipping, v_discount
    ) RETURNING id INTO v_order_id;

    PERFORM _reserve_order_items(v_order_id, p_items, v_expires);

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO order_items (
            order_id, product_id, product_name, product_size, quantity,
            preco_catalogo, desconto, sale_freight, preco_final_line, lucro_line,
            promotion_id, promotion_name, gifts_snapshot
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            COALESCE(v_item->>'product_name', ''),
            COALESCE(v_item->>'product_size', 'M'),
            GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1),
            COALESCE((v_item->>'preco_catalogo')::NUMERIC, 0),
            COALESCE((v_item->>'desconto')::NUMERIC, 0),
            COALESCE((v_item->>'sale_freight')::NUMERIC, 0),
            COALESCE((v_item->>'preco_final_line')::NUMERIC, 0),
            COALESCE((v_item->>'lucro_line')::NUMERIC, 0),
            NULLIF(v_item->>'promotion_id', '')::UUID,
            NULLIF(v_item->>'promotion_name', ''),
            COALESCE(v_item->'gifts_snapshot', '[]'::JSONB)
        );
        v_total := v_total + COALESCE((v_item->>'preco_final_line')::NUMERIC, 0);
    END LOOP;

    IF v_discount > v_total THEN
        v_discount := v_total;
    END IF;

    v_total := GREATEST(v_total - v_discount, 0) + v_shipping;
    UPDATE orders
    SET total_amount = v_total, discount_amount = v_discount
    WHERE id = v_order_id;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'tracking_token', v_tracking,
        'total_amount', v_total,
        'discount_amount', v_discount,
        'expires_at', v_expires
    );
END;
$$;

GRANT EXECUTE ON FUNCTION create_checkout_order(UUID, JSONB, NUMERIC, NUMERIC)
    TO anon, authenticated, service_role;

-- Perfil: busca por e-mail (conta com senha), depois CPF, depois telefone
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
    v_found BOOLEAN := false;
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

    SELECT * INTO v_row FROM customers WHERE lower(email) = v_email LIMIT 1;
    IF FOUND THEN
        v_found := true;
    ELSE
        SELECT * INTO v_row FROM customers WHERE cpf = v_cpf LIMIT 1;
        IF FOUND THEN
            v_found := true;
        ELSE
            SELECT * INTO v_row FROM customers
            WHERE normalize_phone_br(phone) = v_phone LIMIT 1;
            IF FOUND THEN
                v_found := true;
            END IF;
        END IF;
    END IF;

    IF v_found THEN
        UPDATE customers SET
            name = trim(p_name),
            phone = v_phone,
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

    RETURN customer_public_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION save_customer_profile(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

