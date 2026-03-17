-- Add insurance:agent_view and menu:insurance_agents permissions to Admin role
UPDATE roles
SET permissions = (
  SELECT jsonb_agg(DISTINCT value)
  FROM (
    SELECT value FROM jsonb_array_elements_text(permissions::jsonb) AS value
    UNION
    SELECT 'insurance:agent_view'
    UNION
    SELECT 'menu:insurance_agents'
  ) combined
)::json
WHERE name = 'Администратор';

-- Add insurance:agent_view and menu:insurance_agents permissions to Agent role
UPDATE roles
SET permissions = (
  SELECT jsonb_agg(DISTINCT value)
  FROM (
    SELECT value FROM jsonb_array_elements_text(permissions::jsonb) AS value
    UNION
    SELECT 'insurance:agent_view'
    UNION
    SELECT 'menu:insurance_agents'
  ) combined
)::json
WHERE name = 'Агент';
