-- Per-device book editions
CREATE TABLE "devices" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "cover_width" INTEGER,
  "cover_height" INTEGER,
  "cover_fit" TEXT NOT NULL DEFAULT 'contain' CHECK ("cover_fit" IN ('contain', 'cover', 'fill')),
  "bw_cover" BOOLEAN NOT NULL DEFAULT false,
  "simplify" BOOLEAN NOT NULL DEFAULT false,
  "created_at" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  "updated_at" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE UNIQUE INDEX "devices_slug_key" ON "devices" ("slug");
CREATE TABLE "device_editions" (
  "user_id" TEXT NOT NULL,
  "original_book_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "edition_id" TEXT NOT NULL,
  "settings_hash" TEXT NOT NULL,
  "created_at" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY ("user_id", "original_book_id", "device_id")
);
CREATE INDEX "device_editions_user_edition_idx" ON "device_editions" ("user_id", "edition_id");
