-- Run once in Supabase SQL Editor for existing Refad databases.
-- Adds the currency column used by company administration and formatting.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS currency VARCHAR(5) DEFAULT 'EGP';

NOTIFY pgrst, 'reload schema';
