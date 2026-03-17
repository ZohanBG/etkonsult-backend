-- Add resource permissions to existing roles

-- Администратор: add resource:read, resource:manage, menu:resources
UPDATE roles
SET permissions = permissions || '["resource:read", "resource:manage", "menu:resources"]'::jsonb
WHERE name = 'Администратор'
  AND NOT permissions @> '"resource:read"'::jsonb;

-- Служител: add resource:read, menu:resources
UPDATE roles
SET permissions = permissions || '["resource:read", "menu:resources"]'::jsonb
WHERE name = 'Служител'
  AND NOT permissions @> '"resource:read"'::jsonb;
