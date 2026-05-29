-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "file_as" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT NOT NULL DEFAULT '',
    "series" TEXT NOT NULL DEFAULT '',
    "series_index" REAL NOT NULL DEFAULT 0,
    "identifiers" TEXT NOT NULL DEFAULT '[]',
    "subjects" TEXT NOT NULL DEFAULT '[]',
    "cover_data" BLOB,
    "cover_mime" TEXT,
    "size" INTEGER NOT NULL,
    "mtime" REAL NOT NULL,
    "added_at" REAL NOT NULL,
    "chapter_count" INTEGER NOT NULL DEFAULT 0,
    "chapter_spine_map" TEXT NOT NULL DEFAULT '[]',
    "chapter_names" TEXT,
    "page_count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "book_thumbnails" (
    "book_id" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "mime" TEXT NOT NULL,

    PRIMARY KEY ("book_id", "width"),
    CONSTRAINT "book_thumbnails_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "progress" (
    "username" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "percentage" REAL NOT NULL,
    "device" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,

    PRIMARY KEY ("username", "document"),
    CONSTRAINT "progress_username_fkey" FOREIGN KEY ("username") REFERENCES "users" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);
