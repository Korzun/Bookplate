# User Surrogate ID Design

**Date:** 2026-06-09
**Branch:** feat/change-my-passwrod (ongoing feature branch)

## Motivation

The `users` table currently uses `username` as its primary key, which means any future username-rename feature would cascade FK updates across related tables. Adding a stable surrogate ID decouples the user's identity from their display name, enabling renames without touching child rows.

## Scope

- Add a NanoID surrogate `id` as the primary key on `users`
- Demote `username` to a `UNIQUE` constraint
- Migrate `progress` FK from `username` to `user_id`
- Propagate the ID through session state and request context so progress operations never need a username→ID lookup

Out of scope: implementing username rename itself (this is infrastructure for that future work).

---

## Schema

### `users`

| Column   | Type   | Constraints          |
|----------|--------|----------------------|
| id       | TEXT   | PRIMARY KEY          |
| username | TEXT   | NOT NULL, UNIQUE     |
| key      | TEXT   | NOT NULL             |

### `progress`

| Column     | Type    | Constraints                              |
|------------|---------|------------------------------------------|
| user_id    | TEXT    | NOT NULL, FK → users.id ON DELETE CASCADE |
| document   | TEXT    | NOT NULL                                 |
| progress   | TEXT    | NOT NULL                                 |
| percentage | REAL    | NOT NULL                                 |
| device     | TEXT    | NOT NULL                                 |
| device_id  | TEXT    | NOT NULL                                 |
| timestamp  | INTEGER | NOT NULL                                 |

Composite PK: `(user_id, document)`

---

## ID Format

- **Library:** `nanoid` v3 (last CJS-compatible version), using `customAlphabet`
- **Alphabet:** `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789` (62 chars, alphanumeric, URL-safe)
- **Length:** 21 characters (default NanoID length — ~128 bits of entropy with this alphabet)
- Generated in application code (`createUser`); no `@default` on the Prisma field

---

## Migration

New Prisma migration: `0004_add_user_id/migration.sql`

Steps:
1. `ALTER TABLE users ADD COLUMN id TEXT` — adds column as nullable
2. `UPDATE users SET id = lower(hex(randomblob(15)))` — backfills 30-char hex IDs for any existing rows (URL-safe, sufficient uniqueness for a personal server's user table)
3. Recreate `users` with `id` as `PRIMARY KEY` and `UNIQUE` index on `username`
4. Recreate `progress` with `user_id` column (FK to `users.id`), populated by joining on `users.username`, dropping the old `username` column

SQLite does not support `ALTER TABLE` for PK/FK changes, so both tables are recreated via the standard SQLite migration pattern (create new → insert from old → drop old → rename).

---

## `UserStore` changes

### `authenticate(username, key): Promise<string | false>`

Returns the user's `id` on success (was `boolean`). The existing `findUnique` already fetches the user row — we add `id` to the `select` at no extra cost.

### `validateUser(username, password): Promise<string | false>`

Delegates to `authenticate`; return type follows.

### `createUser(username, key): Promise<boolean>`

Generates a NanoID before the Prisma `create` call. Signature unchanged.

### Progress methods — new signatures

```
getProgress(userId: string, document: string): Promise<Progress | null>
saveProgress(userId: string, p: ...): Promise<Progress>
getUserProgress(userId: string): Promise<Progress[]>
clearProgress(userId: string, document: string): Promise<boolean>
```

### `deleteUser(username): Promise<boolean>`

Currently explicitly deletes progress rows before deleting the user (the comment notes FK cascade couldn't be relied upon). After migration the `progress.user_id` FK is defined with `ON DELETE CASCADE`, so the explicit `progress.deleteMany` call is removed — the cascade handles it. The method becomes a single `user.delete({ where: { username } })`, no transaction needed.

All other methods (`changePassword`, `userExists`, `listUsers`) are unchanged — they look up by `username`, which remains uniquely indexed.

---

## Session & Request Context

### Session (`express-session`)

`userId: string` added alongside the existing `username`. Set at login for regular users.

### `global.d.ts`

- `Request`: add `kosyncUserId?: string`
- Session namespace: add `userId?: string`

### `kosyncAuth` middleware

After a successful `authenticate` call (which now returns the ID), sets both:
- `req.kosyncUser = username` (kept for logging and KOSync protocol responses)
- `req.kosyncUserId = id`

### Login route (`POST /api/login`)

When `validateUser` succeeds, stores `req.session.userId = returnedId` alongside `req.session.username`.

### Callers

| Route file   | Was                        | Becomes                      |
|--------------|----------------------------|------------------------------|
| `ui.ts`      | `req.session.username!`    | `req.session.userId!`        |
| `kosync.ts`  | `req.kosyncUser!`          | `req.kosyncUserId!`          |

`req.session.username` and `req.kosyncUser` are retained for display/logging only.

---

## Tests

Existing tests updated where they:
- Assert `authenticate`/`validateUser` return value (now `string | false`)
- Call progress methods with a username string (updated to pass a userId)
- Check session shape (add `userId`)
- Check `req.kosyncUserId` in auth middleware tests

No new test cases required — behaviour is identical, only the internal identifier changes.
