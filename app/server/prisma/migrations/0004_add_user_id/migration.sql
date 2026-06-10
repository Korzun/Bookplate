-- Ensure users table exists before we alter it (defensive guard for legacy test databases)
CREATE TABLE IF NOT EXISTS "users" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL
);

-- Add id column (nullable for now). Backfilled with NanoID-format values and
-- promoted to primary key by the data_v10_user_surrogate_id data migration,
-- which also recreates "progress" with a "user_id" foreign key.
ALTER TABLE "users" ADD COLUMN "id" TEXT;
