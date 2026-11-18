-- Intentionally empty.
--
-- `book_collections` carries foreign keys to `books`, and `collections` to
-- `users`; `data_v10_user_surrogate_id` and `data_v11_per_user_libraries`
-- rebuild those tables from explicit column lists, so anything the DDL pass
-- attaches to them is dropped on its way in. Both tables are therefore created
-- by `data_v25_collections` in `db/migrate.ts`, which runs after them. Same
-- treatment, same reason, as `20261025000000_add_mcp`.
SELECT 1;
