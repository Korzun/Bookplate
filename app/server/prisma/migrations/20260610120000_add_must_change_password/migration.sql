-- Add must_change_password flag to users.
-- Set to true when an admin resets a user's password; cleared when the
-- user successfully changes their own password.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT 0;
