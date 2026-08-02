-- 025_shipping_zones.sql
-- Zonas de frete (grátis / pago / bloqueado) e endereço remetente.

ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS sender_zip TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS sender_street TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS sender_number TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS sender_complement TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS sender_neighborhood TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS sender_city TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS sender_state TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS default_package_weight_kg NUMERIC(6,3) NOT NULL DEFAULT 0.3,
    ADD COLUMN IF NOT EXISTS melhor_envio_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shipping_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_type TEXT NOT NULL CHECK (zone_type IN ('free', 'paid', 'blocked')),
    scope TEXT NOT NULL CHECK (scope IN ('country', 'state', 'city', 'neighborhood')),
    country TEXT NOT NULL DEFAULT 'BR',
    state TEXT DEFAULT '',
    city TEXT DEFAULT '',
    neighborhood TEXT DEFAULT '',
    freight_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    label TEXT DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_zones_active ON shipping_zones (active);
CREATE INDEX IF NOT EXISTS idx_shipping_zones_scope ON shipping_zones (scope, state, city);

ALTER TABLE shipping_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipping_zones_public_read ON shipping_zones;
CREATE POLICY shipping_zones_public_read ON shipping_zones
    FOR SELECT USING (active = true);

DROP POLICY IF EXISTS shipping_zones_auth_all ON shipping_zones;
CREATE POLICY shipping_zones_auth_all ON shipping_zones
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Resolve zona mais específica para um endereço
CREATE OR REPLACE FUNCTION resolve_shipping_zone(
    p_country TEXT DEFAULT 'BR',
    p_state TEXT DEFAULT '',
    p_city TEXT DEFAULT '',
    p_neighborhood TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row shipping_zones%ROWTYPE;
    v_country TEXT := upper(trim(COALESCE(p_country, 'BR')));
    v_state TEXT := upper(trim(COALESCE(p_state, '')));
    v_city TEXT := lower(trim(COALESCE(p_city, '')));
    v_neighborhood TEXT := lower(trim(COALESCE(p_neighborhood, '')));
BEGIN
    IF v_country = '' THEN
        v_country := 'BR';
    END IF;

    SELECT * INTO v_row
    FROM shipping_zones
    WHERE active = true
      AND upper(country) = v_country
      AND (
        (scope = 'neighborhood' AND upper(state) = v_state
            AND lower(city) = v_city AND lower(neighborhood) = v_neighborhood)
        OR (scope = 'city' AND upper(state) = v_state AND lower(city) = v_city)
        OR (scope = 'state' AND upper(state) = v_state)
        OR (scope = 'country' AND upper(country) = v_country)
      )
    ORDER BY
        CASE scope
            WHEN 'neighborhood' THEN 4
            WHEN 'city' THEN 3
            WHEN 'state' THEN 2
            WHEN 'country' THEN 1
            ELSE 0
        END DESC,
        priority DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('zone_type', 'none', 'freight_amount', 0);
    END IF;

    RETURN jsonb_build_object(
        'zone_type', v_row.zone_type,
        'freight_amount', v_row.freight_amount,
        'scope', v_row.scope,
        'label', v_row.label
    );
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_shipping_zone(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
