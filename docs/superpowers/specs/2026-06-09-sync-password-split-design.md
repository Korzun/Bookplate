# Design: Split Login and Sync Passwords

**Date:** 2026-06-09
**Status:** Approved

## Problem

The `User` model has a single `key` field storing `MD5(password)`. This hash is shared by three separate auth paths:

- Web UI login (session auth)
- KOSync (`x-auth-key` header — KoReader sends MD5 client-side)
- OPDS (HTTP Basic Auth — server hashes plaintext with MD5)

MD5 is unsalted and unsuitable for login credential storage. The KOSync protocol requires MD5 by design (KoReader hashes before sending), so replacing it for login requires separating the two credentials.

## Solution

Split `key` into two independent fields:

- `passwordHash` — argon2id hash of the login password, used only by web UI session auth
- `syncPassword` — plaintext auto-generated two-word phrase, used by KOSync and OPDS

KOSync and OPDS auth compute `MD5(syncPassword)` at comparison time. `syncPassword` is stored plaintext so it can be displayed in the UI.

## Data Model

```prisma
model User {
  username     String     @id
  passwordHash String?            // argon2id; null = password not yet set (force-reset state)
  syncPassword String             // plaintext, e.g. "blue maple"
  progresses   Progress[]

  @@map("users")
}
```

### Migration

1. Add `passwordHash` (nullable) and `syncPassword` (temporary default `""`)
2. Data step: generate a unique two-word phrase for every existing user and write it to `syncPassword`
3. Drop `key`
4. All existing `passwordHash` values remain null (force-reset — users cannot log in until admin sets a new password via the admin UI)

## Server

### `UserStore` changes

| Method | Change |
|--------|--------|
| `hashPassword()` | Removed |
| `hashSyncPassword(syncPassword)` | New static — returns `MD5(syncPassword)` |
| `hashLoginPassword(password)` | New static async — returns argon2id hash |
| `verifyLoginPassword(password, hash)` | New static async — argon2 verify |
| `validateUser(username, password)` | Updated: argon2 verify against `passwordHash`; returns `false` if `passwordHash` is null |
| `authenticate(username, key)` | Renamed to `authenticateSync(username, key)` — compares `key` against `MD5(user.syncPassword)` |
| `changePassword(username, hash)` | Updated: writes `passwordHash` |
| `changeSyncPassword(username, syncPassword)` | New — stores new plaintext phrase; returns `false` if user not found |
| `getSyncPassword(username)` | New — returns plaintext phrase, or `null` if user not found |
| `generateSyncPassword()` | New static — picks two words from bundled wordlist, joined with space, total ≤ 15 chars |
| `createUser(username, passwordHash, syncPassword?)` | Updated: accepts nullable `passwordHash` (null = no password set); auto-generates `syncPassword` if not provided; called by admin register endpoint with `passwordHash: null` |

### Auth middleware

- `kosyncAuth`: calls `userStore.authenticateSync(username, key)` — unchanged behaviour, new method name
- `opdsAuth`: calls `userStore.authenticateSync(username, MD5(plaintextPassword))` — same as before structurally
- Session login: calls `validateUser()` — argon2 internally, same external API. The login route checks `passwordHash` is null specifically (via a new `userHasPassword(username): Promise<boolean>` method) to return a distinct `403` with `{ error: 'Password not set — contact an admin' }` instead of the generic `401`, so users understand why they cannot log in after a force-reset migration.

### KOSync registration disabled

`POST /kosync/users/create` is removed. KoReader devices can still auth and sync; they cannot self-register. Users are created exclusively via the admin UI. The endpoint returns `404` to prevent confusion.

### New API endpoints

Both require session auth, non-admin only.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ui/me/sync-password` | Returns `{ syncPassword: string }` |
| `POST` | `/api/ui/me/sync-password/regenerate` | Generates new phrase, saves, returns `{ syncPassword: string }` |

## Sync Password Generation

- Word list: ~200 common 3–7 letter English words, bundled in `app/server/services/wordlist.ts`
- Words chosen for readability: short, common, no confusable homophones, no offensive terms
- Generation: pick two words at random; reject and retry if `word1 + " " + word2 > 15 chars`
- In practice nearly all pairs of words ≤ 7 chars satisfy the constraint; retry rate is negligible
- Entropy: ~15 bits (log₂(200²)) — intentionally low for usability; the login password is the security boundary

## Client

### New hooks

- `useSyncPassword()` → `[syncPassword, loading, error]` — fetches `GET /api/ui/me/sync-password` on mount
- `useRegenerateSyncPassword()` → `[regenerate, loading, okay, error]` — calls `POST /api/ui/me/sync-password/regenerate`

### New component: `SyncPassword`

Collapsible `Card` with title "Sync password". Rendered on the user profile page (`/page/user/`) below `UserChangePassword`, visible to non-admin users only (same gate as `UserChangePassword`).

**Behaviour:**
- Displays the sync password phrase in a read-only text field on load
- **Copy** button: calls `navigator.clipboard.writeText(syncPassword)`; shows brief "Copied!" feedback label
- **Regenerate** button: opens `ConfirmModal` before acting

**Confirmation modal:**
> **Regenerate sync password?**
> This will create a new sync password. Your KoReader devices and any OPDS clients will stop syncing until you update them with the new password.
>
> [Cancel] [Regenerate]

On confirm: calls regenerate, updates the displayed phrase, shows a success `Toast`.

**Reuses:** existing `ConfirmModal` control, existing `Toast` component, existing `Card` collapsible pattern.

## Out of Scope

- Admin ability to view or reset another user's sync password (separate follow-up)
- Expanding sync password entropy / word count
