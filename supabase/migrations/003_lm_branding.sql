-- 003_lm_branding.sql
-- Identidade visual LM moda feminina
-- Rode após 001 e 002 (ou sozinho se o schema inicial já existir).

UPDATE store_settings
SET
    store_name = 'LM moda feminina',
    primary_color = '#C71585',
    secondary_color = '#D4AF37',
    accent_color = '#F8C8DC',
    updated_at = NOW()
WHERE store_name = 'Minha Loja'
   OR primary_color = '#E1306C';

INSERT INTO store_settings (store_name, whatsapp_number, primary_color, secondary_color, accent_color)
SELECT 'LM moda feminina', '', '#C71585', '#D4AF37', '#F8C8DC'
WHERE NOT EXISTS (SELECT 1 FROM store_settings LIMIT 1);
