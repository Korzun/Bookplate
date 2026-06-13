-- This migration is intentionally a no-op.
--
-- The series table and series_id column on books are created by the
-- data_v12_series_table data migration in migrate.ts, which runs after
-- data_v10_user_surrogate_id promotes users.id to PRIMARY KEY (required
-- for the series.user_id FK to be valid in SQLite).
SELECT 1;
