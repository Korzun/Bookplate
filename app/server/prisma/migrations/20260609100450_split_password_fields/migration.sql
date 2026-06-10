/*
  Warnings:

  - You are about to drop the column `key` on the `users` table. All the data in the column will be lost.

*/
-- Create legacy users table if missing (for databases that skipped the baseline migration)
CREATE TABLE IF NOT EXISTS "users" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL DEFAULT ''
);
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT,
    "username" TEXT NOT NULL PRIMARY KEY,
    "password_hash" TEXT,
    "sync_password" TEXT
);
INSERT INTO "new_users" ("username") SELECT "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
