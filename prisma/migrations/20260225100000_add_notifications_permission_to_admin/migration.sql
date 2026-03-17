-- Add menu:notifications permission to Администратор role
UPDATE roles
SET permissions = permissions || '["menu:notifications"]'::jsonb
WHERE name = 'Администратор'
  AND NOT permissions @> '"menu:notifications"'::jsonb;
