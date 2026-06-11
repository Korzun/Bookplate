-- Add user_id columns (nullable for now). Backfilled per user and promoted to
-- composite primary keys by the data_v11_per_user_libraries data migration,
-- which also rebuilds these tables with foreign keys to "users".
ALTER TABLE "books" ADD COLUMN "user_id" TEXT;
ALTER TABLE "book_thumbnails" ADD COLUMN "user_id" TEXT;
ALTER TABLE "book_id_history" ADD COLUMN "user_id" TEXT;
