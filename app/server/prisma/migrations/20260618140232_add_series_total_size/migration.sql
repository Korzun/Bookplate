-- This migration is intentionally a no-op.
--
-- The total_size column is added by the data_v14_series_total_size data migration
-- in migrate.ts (and for fresh installs it is included in the CREATE TABLE statement
-- in data_v12_series_table). The Prisma DDL migration cannot run ALTER TABLE here
-- because the series table itself is created later by the data_v12_series_table
-- data migration.
SELECT 1;
