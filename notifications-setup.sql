-- Run once in Supabase SQL Editor for an existing Refad database.
-- Grants notification inbox access to users with a permissioned notification scope
-- and enables realtime delivery. Individual notification types still respect scope
-- permissions in Refad core.

INSERT INTO permissions (code, name_ar, module)
VALUES ('notifications.view', 'عرض الإشعارات', 'notifications')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.company_id IS NOT NULL
  AND p.code = 'notifications.view'
  AND (
    r.is_owner = TRUE
    OR EXISTS (
      SELECT 1
      FROM role_permissions rp
      JOIN permissions scope ON scope.id = rp.permission_id
      WHERE rp.role_id = r.id
        AND scope.code IN ('inventory.view', 'sales.view', 'purchases.view', 'chat.use')
    )
  )
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
