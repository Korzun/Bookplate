# Per-User Libraries

**Date:** 2026-06-10
**Status:** Approved

## Overview

Libraries change from one global, admin-managed collection to one library per user.
Each user fully owns their library: they can upload, delete, edit metadata,
regenerate chapters, manage lineage, and trigger scans for their own books. Books
are stored in per-user folders on disk, and book tables gain a `user_id` column so
identical books owned by different users never collide.

The admin account keeps no library of its own. It retains user management and gains
oversight: through a library switcher in the web UI it can operate on any user's
library with the same capabilities the owner has.

## Disk layout

- Each user's books live in `/media/books/<username>/<hash>.epub`.
- Upload staging stays shared at `/media/books/.staging` (transient files only;
  imports move files into the owner's folder).
- User folders are created at startup for every user and at user creation. Deleting
  a user deletes their folder.
- The legacy flat files at `/media/books/*.epub` are removed by the data migration
  (see Migration).

## Username safety

Folders are named by username, so usernames must be filesystem-safe:

- New validation at user creation (server-side, in the users routes/user-store):
  usernames must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Starting alphanumeric rules
  out hidden folders and collision with `.staging`; the allowed set rules out path
  separators and other special characters.
- Existing users with non-conforming usernames are renamed during migration:
  invalid characters are replaced with `-`; if the result duplicates another
  username, a numeric suffix is appended. A prominent warning is logged for each
  rename. Known trade-off: a renamed user's KOReader sync and OPDS logins break
  until they update the username on their device. In practice usernames are
  expected to already be plain alphanumeric; the rename is a deterministic safety
  net, not an expected path.

## Schema changes (one Prisma migration)

- `Book`: add `user_id`; primary key becomes `(user_id, id)`. Foreign key to
  `users(id)` with `onDelete: Cascade`.
- `BookThumbnail`: add `user_id`; primary key becomes `(user_id, book_id, width)`;
  composite foreign key to `Book` with the same cascade behavior as today.
- `BookIdHistory`: add `user_id`; primary key becomes `(user_id, old_id)`. Lineage
  chains are scoped per user.
- `Progress` and `User` are unchanged. Progress is already keyed
  `(user_id, document)`; content hashes don't change in the migration, so all
  reading progress survives.

## Migration (one-time, at startup, existing migration mechanism)

For every existing book × every existing user:

1. Copy the epub file into the user's folder.
2. Duplicate the `Book`, `BookThumbnail`, and `BookIdHistory` rows with that
   `user_id`.

After all users are populated, delete the legacy flat files (and the original
unscoped rows, replaced by the per-user copies).

Edge case — zero users exist: the legacy files and rows are deleted. The library
was unreachable by anyone but the admin anyway; a log line records the deletion.

## Server

### BookStore becomes owner-scoped

- One `BookStore` instance, constructed with the books *root* directory.
- Every method gains an `owner` parameter (`{ userId, username }`): `userId`
  scopes all queries; `username` resolves the folder
  `/media/books/<username>/`.
- `scan(owner)` scans only that user's folder. The startup scan iterates all
  users, creating missing folders and scanning each.
- The thumbnail queue keys jobs by `(userId, bookId)` and reconciles per user.

### Routes and authorization

- Every `/api/books*` route drops `adminAuth` and operates on the session user's
  own library. Delete, metadata editing, chapter regen, scan, and lineage
  link/unlink become available to every user for their own books.
- Admin targeting: all book routes accept `?user=<username>`, honored only for
  admin sessions (the library switcher supplies it).
  - Non-admin sending `?user=` → 403.
  - Admin omitting `?user=` on a book route → 400 (admins have no library).
- Upload goes to the session user's library; for admins, to the targeted user's
  library.
- `/api/users*` stays admin-only, now with username validation.
- Progress and sync-password routes are unchanged (still blocked for admin).

### OPDS

Basic auth already identifies the user; the root feed, books feed, downloads, and
covers serve only that user's library. The admin config account cannot use OPDS
(unchanged — it has no sync password).

### KOSync

Untouched. Progress is already per-user and documents are content hashes that
survive the migration.

### Error handling

- Duplicate-upload conflict (`BookAlreadyExistsError`, 409) is scoped per user:
  two users may own the same epub; the same user uploading twice still gets 409.
- Requests for a book ID owned by a different user return 404 — no information
  leak about other libraries.

## Client

- Ownership affordances replace admin gating: the delete-book button,
  regen-chapters, lineage unlink, and edit affordances on the book/series pages
  lose their `isAdmin` checks — every user sees them for their own library.
- `isAdmin` gating remains only for: user management (user list page), the
  library switcher, and the existing blocks on My Progress / sync password
  (the admin account has no reading state).
- Library switcher (admin only): a user picker in the header, populated from
  `/api/users`, selection persisted across refreshes in localStorage. The
  book provider appends `?user=<username>` to all book API calls when an admin
  has a selection. With no selection, the library page shows a "select a user"
  prompt instead of a grid.
- Upload page works for admins, targeting the selected user's library; unchanged
  for regular users.

## Testing

- Server route tests (colocated `*.test.ts`, supertest): owner scoping — user A
  cannot see/delete/edit user B's book (404); non-admin with `?user=` → 403;
  admin with `?user=` operates on the target library; admin without → 400. OPDS
  tests assert per-user feeds.
- BookStore tests: scoped scan; duplicate upload within one user vs. across
  users; user deletion cascades rows and removes the folder.
- Migration tests: seed a flat library + N users in a temp dir; assert files
  copied per user, rows duplicated with `user_id`, legacy files deleted; zero-user
  case deletes legacy files and rows.
- Client tests (Vitest/RTL): owner affordances visible for regular users;
  switcher visible only for admins; fetches carry `?user=` for admins.
- Workflow: `npm test` and `npm run lint` after every task.

## Out of scope

- Sharing books between users, shared/multiple libraries per user (rejected
  Library-entity generality — YAGNI).
- Per-user storage quotas.
- Deduplicating identical files across user folders (disk duplication accepted).
- Username renames as a feature.
