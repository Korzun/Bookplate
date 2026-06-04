-- Add type column to book_id_history.
-- DEFAULT 'edit' backfills existing rows. CHECK is enforced by SQLite at write time.
-- Prisma does not support CHECK constraints for SQLite; enforcement lives here only.
ALTER TABLE book_id_history
  ADD COLUMN type TEXT NOT NULL DEFAULT 'edit'
  CHECK (type IN ('edit', 'merge'));
