-- Ensure book_thumbnails exists before we alter it (defensive guard for legacy
-- databases where the 0000_baseline DDL was skipped because "books" predated it).
-- Definition matches 0000_baseline.
CREATE TABLE IF NOT EXISTS "book_thumbnails" (
    "book_id" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "mime" TEXT NOT NULL,

    PRIMARY KEY ("book_id", "width"),
    CONSTRAINT "book_thumbnails_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add user_id columns (nullable for now). Backfilled per user and promoted to
-- composite primary keys by the data_v11_per_user_libraries data migration,
-- which also rebuilds these tables with foreign keys to "users".
ALTER TABLE "books" ADD COLUMN "user_id" TEXT;
ALTER TABLE "book_thumbnails" ADD COLUMN "user_id" TEXT;
ALTER TABLE "book_id_history" ADD COLUMN "user_id" TEXT;
