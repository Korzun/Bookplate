-- CreateTable
CREATE TABLE "progress_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "percentage" REAL NOT NULL,
    "device" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "start_timestamp" INTEGER NOT NULL,
    "end_timestamp" INTEGER NOT NULL,
    CONSTRAINT "progress_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "progress_history_user_id_document_idx" ON "progress_history"("user_id", "document");
