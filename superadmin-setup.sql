-- Run once in Supabase SQL Editor for an existing Refad database.
-- This creates the system administrator in the database, not in frontend code.

BEGIN;

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE roles
SET is_owner = TRUE
WHERE company_id IS NOT NULL
  AND name = 'admin';

INSERT INTO permissions (code, name_ar, module)
VALUES
  ('admin.full', 'إدارة الشركات', 'admin'),
  ('notifications.view', 'عرض الإشعارات', 'notifications')
ON CONFLICT (code) DO NOTHING;

-- The company owner is not the system-wide administrator.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.company_id IS NOT NULL
  AND p.code = 'admin.full';

-- Keep existing company-admin accounts able to use notifications.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.company_id IS NOT NULL
  AND r.name = 'admin'
  AND p.code = 'notifications.view'
ON CONFLICT DO NOTHING;

DO $setup$
DECLARE
  superadmin_role_id BIGINT;
BEGIN
  SELECT id INTO superadmin_role_id
  FROM roles
  WHERE company_id IS NULL
    AND name = 'superadmin'
  ORDER BY id
  LIMIT 1;

  IF superadmin_role_id IS NULL THEN
    INSERT INTO roles (company_id, name, name_ar, description, is_system, is_owner)
    VALUES (NULL, 'superadmin', 'مدير الشركات', 'إدارة جميع الشركات', TRUE, FALSE)
    RETURNING id INTO superadmin_role_id;
  ELSE
    UPDATE roles
    SET is_system = TRUE, is_owner = FALSE
    WHERE id = superadmin_role_id;
  END IF;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT superadmin_role_id, id
  FROM permissions
  ON CONFLICT DO NOTHING;

  INSERT INTO users (
    company_id, role_id, username, password, full_name, is_active, has_device
  )
  VALUES (
    NULL, superadmin_role_id, 'superadmin', '22446688', 'مدير الشركات', TRUE, TRUE
  )
  ON CONFLICT (username) DO UPDATE
  SET company_id = NULL,
      role_id = EXCLUDED.role_id,
      password = EXCLUDED.password,
      full_name = EXCLUDED.full_name,
      is_active = TRUE;
END
$setup$;

COMMIT;
