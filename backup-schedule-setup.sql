-- Private Supabase Storage bucket for scheduled company data snapshots.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES ('refad-backups', 'refad-backups', FALSE, ARRAY['application/gzip'])
ON CONFLICT (id) DO UPDATE SET public = FALSE;

-- Enable Supabase's built-in scheduled HTTP call support.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Before running this script:
-- 1) Deploy supabase/functions/refad-backup with BACKUP_CRON_SECRET set.
-- 2) Add the exact same secret in Supabase Vault as refad_backup_cron_secret.
-- 3) Replace YOUR_PROJECT_REF below with the actual Supabase project ref.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'refad-daily-company-backup';

SELECT cron.schedule(
  'refad-daily-company-backup',
  '0 2 * * *',
  $job$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/refad-backup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-backup-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'refad_backup_cron_secret'
          LIMIT 1
        )
      ),
      body := '{"source":"daily-cron"}'::jsonb
    );
  $job$
);
