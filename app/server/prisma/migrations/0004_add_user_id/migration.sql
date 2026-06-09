-- Ensure users table exists before we alter it (defensive guard for legacy test databases)
CREATE TABLE IF NOT EXISTS "users" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL
);

-- Add id column (nullable for now so we can backfill)
ALTER TABLE "users" ADD COLUMN "id" TEXT;

-- Backfill IDs for existing rows using SQLite random bytes
UPDATE "users" SET "id" = lower(hex(randomblob(15))) WHERE "id" IS NULL;

-- Recreate users with id as PK and username as UNIQUE
CREATE TABLE "users_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "key" TEXT NOT NULL
);
INSERT INTO "users_new" ("id", "username", "key")
    SELECT "id", "username", "key" FROM "users";
DROP TABLE "users";
ALTER TABLE "users_new" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- Recreate progress with user_id FK (inner join: orphaned progress rows are dropped)
CREATE TABLE "progress_new" (
    "user_id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "percentage" REAL NOT NULL,
    "device" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    PRIMARY KEY ("user_id", "document"),
    CONSTRAINT "progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "progress_new" ("user_id", "document", "progress", "percentage", "device", "device_id", "timestamp")
    SELECT u."id", p."document", p."progress", p."percentage", p."device", p."device_id", p."timestamp"
    FROM "progress" p
    INNER JOIN "users" u ON u."username" = p."username";
DROP TABLE "progress";
ALTER TABLE "progress_new" RENAME TO "progress";
