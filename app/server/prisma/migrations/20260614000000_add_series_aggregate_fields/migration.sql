-- Note: These columns are added during data_v12_series_table in migrate.ts,
-- so this migration is idempotent and safe for databases that already have
-- the columns. New databases will get them from the initial table creation.
-- We leave this as a no-op since the columns are already part of the schema.
SELECT 1;
