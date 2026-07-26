-- No-op. The validations / validation_messages tables have a composite FK to
-- books(user_id, id), which only exists after data_v11_per_user_libraries
-- rebuilds "books" with its composite primary key. Creating the tables in this
-- DDL pass would raise "foreign key mismatch" on older databases. The real
-- CREATE TABLE runs in data_v17_validation in db/migrate.ts. See
-- 20260725000000_add_pending_fixes for the same pattern.
SELECT 1;
