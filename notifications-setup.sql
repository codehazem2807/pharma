-- Run once in Supabase SQL Editor for an existing Refad database.
-- Grants notification access to company admin roles and enables realtime delivery.

INSERT INTO permissions (code, name_ar, module)
VALUES ('notifications.view', 'عرض الإشعارات', 'notifications')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.company_id IS NOT NULL
  AND r.name = 'admin'
  AND p.code = 'notifications.view'
ON CONFLICT DO NOTHING;

DO $setup$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$setup$;
