CREATE TABLE "device_users" (
  "device_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "created_at" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY ("device_id", "user_id"),
  CONSTRAINT "device_users_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "device_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "device_users_user_id_idx" ON "device_users" ("user_id");
