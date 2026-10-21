-- CreateTable
CREATE TABLE "reading_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "ts" INTEGER NOT NULL,
    "document" TEXT,
    "body" TEXT NOT NULL,
    "received_at" REAL NOT NULL,
    CONSTRAINT "reading_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "reading_events_user_id_device_id_event_id_key" ON "reading_events"("user_id", "device_id", "event_id");

-- CreateIndex
CREATE INDEX "reading_events_user_id_document_idx" ON "reading_events"("user_id", "document");
