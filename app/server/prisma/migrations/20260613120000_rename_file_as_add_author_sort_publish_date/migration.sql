-- Rename file_as to title_sort, add author_sort and publish_date
ALTER TABLE books RENAME COLUMN file_as TO title_sort;
ALTER TABLE books ADD COLUMN author_sort TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN publish_date TEXT NOT NULL DEFAULT '';
