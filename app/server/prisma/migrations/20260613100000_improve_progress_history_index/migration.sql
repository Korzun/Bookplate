-- Widen the progress_history lookup index to cover the full merge-query predicate
-- (userId, document, progress, deviceId) + ordering column (endTimestamp).
DROP INDEX "progress_history_user_id_document_idx";
CREATE INDEX "progress_history_user_id_document_progress_device_id_end_timestamp_idx" ON "progress_history"("user_id", "document", "progress", "device_id", "end_timestamp");
