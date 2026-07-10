-- SQLite can't ALTER a CHECK constraint in place, so rebuild the devices table
-- with 'smart' added to cover_fit. device_editions has no FK to devices, so a
-- plain rebuild is safe. The migration runner strips -- comments and splits on
-- ';', executing each statement separately.
CREATE TABLE "devices_new" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "cover_width" INTEGER,
  "cover_height" INTEGER,
  "cover_fit" TEXT NOT NULL DEFAULT 'contain' CHECK ("cover_fit" IN ('contain', 'cover', 'fill', 'smart')),
  "bw_cover" BOOLEAN NOT NULL DEFAULT false,
  "simplify" BOOLEAN NOT NULL DEFAULT false,
  "created_at" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  "updated_at" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
INSERT INTO "devices_new" ("id", "name", "slug", "cover_width", "cover_height", "cover_fit", "bw_cover", "simplify", "created_at", "updated_at")
  SELECT "id", "name", "slug", "cover_width", "cover_height", "cover_fit", "bw_cover", "simplify", "created_at", "updated_at" FROM "devices";
DROP TABLE "devices";
ALTER TABLE "devices_new" RENAME TO "devices";
CREATE UNIQUE INDEX "devices_slug_key" ON "devices" ("slug");
