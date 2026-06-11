-- CreateTable
CREATE TABLE "refresh_tokens" (
    "token_hash" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "username" TEXT NOT NULL,
    "expires_at" REAL NOT NULL,
    CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "refresh_tokens_username_idx" ON "refresh_tokens"("username");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
