# Progress History Design

**Date:** 2026-06-12

## Overview

Extend the KOSync sync endpoint to record a time-series history of reading progress alongside the existing current-position store. Each history row represents a "dwell event" — the reader at a specific position for a measurable span of time — enabling a future UI to show what was read, from which device, and over what time period.

## Background

The existing `progress` table stores one row per `(userId, document)` and is overwritten on every sync. KOReader syncs frequently while reading (every few minutes), so each sync reflects the current position in the book. No prior positions are retained today.

## Goals

- Record every sync as a history entry, grouped when the same position is synced from the same device within 10 minutes.
- Do not break the existing KOSync protocol (GET `/syncs/progress/:document` must remain unchanged).
- Keep the write path simple: one conditional upsert per sync appended to `saveProgress`.

## Data Model

A new `ProgressHistory` table is added. The existing `Progress` table is **not modified**.

```prisma
model ProgressHistory {
  id             Int    @id @default(autoincrement())
  userId         String @map("user_id")
  document       String
  progress       String
  percentage     Float
  device         String
  deviceId       String @map("device_id")
  startTimestamp Int    @map("start_timestamp")
  endTimestamp   Int    @map("end_timestamp")
  user           User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, document])
  @@map("progress_history")
}
```

- `progress` is the exact CFI string sent by KOReader. Grouping uses exact match so any forward reading — even a single page — opens a new dwell row.
- `startTimestamp` / `endTimestamp` are Unix seconds, matching the convention of the existing `Progress.timestamp` field.
- `@@index([userId, document])` covers the grouping lookup and future per-book history queries.
- `onDelete: Cascade` ensures history is cleaned up when a user is deleted.

## Write Logic

`UserStore.saveProgress` is extended. After the existing `progress.upsert`, a second write handles history:

1. Query the most recent `ProgressHistory` row matching `(userId, document, progress, deviceId)`, ordered by `endTimestamp DESC`, limit 1.
2. If found **and** `endTimestamp >= now - 600`: update `endTimestamp = now`.
3. Otherwise: insert a new row with `startTimestamp = endTimestamp = now`.

Both writes use the same `timestamp` value already computed at the top of `saveProgress` so history timestamps are consistent with what is returned to KOReader.

### Grouping key

`(userId, document, progress, deviceId)` — "same position from the same device." A different device syncing the same position (e.g., two Kindles open to the same spot) produces separate rows, which accurately reflects device-level reading activity.

### 10-minute window

600 seconds. Not configurable for now; can be extracted to a constant if the value needs to change later.

## Error Handling

History write failures are non-fatal. The KOSync `PUT /syncs/progress` response (`document` + `timestamp`) depends only on the `Progress` upsert. If the history write throws, the error is logged as a warning and the sync response proceeds normally. KOReader must not fail due to internal bookkeeping.

## Testing

`user-store.test.ts` and `kosync.test.ts` are extended with the following cases:

| Scenario | Expected outcome |
|---|---|
| First sync for a book | New history row; `startTimestamp == endTimestamp` |
| Same position + device, within 10 min | `endTimestamp` updated; row count unchanged |
| Same position + device, after 10 min | New history row inserted |
| Different position | New history row; prior row untouched |
| Different device, same position | New history row (separate device dwell) |

## Out of Scope

- Retention / pruning policy (unlimited rows for now)
- API endpoint to read history (deferred to UI phase)
- Client-side display (deferred to UI phase)
