# Preview demo seed

## Intent

The Coolify preview (`book-preview.korzun.com`, built from the `preview`
branch) starts empty after every deploy, so every test begins with creating
accounts and uploading books. A demo seed fills the preview with a known,
realistic data set on every start, so both the user and Claude can test
straight away against users, books, requests and reading history that are
always there and always the same.

## Goals

- When the container starts with `SEED_DEMO=1`, the app wipes its data and
  library, runs migrations, seeds the demo data set, then serves as normal.
- Every start gives the same data set (same users, books, requests, states).
- The data covers the screens we actually test: library grid with covers,
  a series, ratings, validation report, pending metadata fix, requests in each
  state, reading progress and stats, a KoReader device, the first-login
  "set your email" flow.
- Seeded users share one known password, set in Coolify.

## Non-goals

- Seeding notification outbox rows, push subscriptions or MCP grants (those
  come from real use).
- A seed for local dev or tests (the existing test harness stays as is). The
  seed may be reused for that later, but nothing here depends on it.
- Any change to the Home Assistant add-on's behaviour.

## Anti-goals

- **Production must never be wiped.** Without `SEED_DEMO=1` startup is
  exactly as it is today. The HA add-on never sets it; only the Coolify
  preview app does.
- The seed must not send real email or push (use `example.com` addresses;
  mail isn't configured on the preview anyway).

## Constraints

- Books belong to a user: each user has their own `Book` rows and EPUB files
  under `BOOKS_DIR/<username>/`. A seeded book must be a real EPUB imported
  through the app's own import code (`services/import-epub.ts` /
  `epub-import-pipeline.ts`), so book ids, covers, thumbnails, validation and
  pending fixes are what the app itself would produce.
- Other data goes through existing services where one exists
  (`services/user.ts` `createUser`, `services/book-request.ts`,
  `services/progress.ts`, `services/device.ts`), not raw inserts, so the seed
  breaks loudly when a service's contract changes.
- The runtime image copies only `app/server/dist`, `prisma` and the client
  build; the fixture EPUBs need their own `COPY` into the runtime stage.
- Fixture EPUBs must be redistributable: public domain / CC0 only (e.g.
  Standard Ebooks, which releases its editions under CC0).

## Approaches

**Where the books come from**
- A. Generate EPUBs in code (fake titles, placeholder text, generated covers):
  no binaries in the repo, but looks fake on KoReader and in the grid.
- B. Commit ~8 real public-domain EPUBs: real covers and chapters, ~3–6 MB
  of fixtures; the broken cases need hand-edited copies.
- **C. B plus derived edge cases — chosen.** Real books form the normal
  library; the seed derives the odd cases at seed time by copying a real book
  and damaging it (strip cover, drop author, etc.). Real-feeling preview,
  edge cases stay in code and easy to change.

**How the reset runs**
- **Seed code ships in the image, runs at container start behind
  `SEED_DEMO=1` — chosen.** Wipe, migrate, seed, then serve.
- Coolify pre-deployment command — rejected: it runs in the old container
  before the new image is live.
- Seed only into an empty DB — rejected by the user in favour of a reset on
  every deploy (predictable state beats keeping hand-made changes).

## Design (as decided)

1. **Trigger.** `SEED_DEMO` env var, read through `config.ts`'s `envVar`
   (blank = unset). Only the exact value `1` enables it. Note: this runs on
   every container start, so a Coolify *restart* also resets the preview —
   accepted.
2. **Reset.** Before `runMigrations` in `index.ts`: delete the contents of
   `DATA_DIR` and `BOOKS_DIR` (not the mount points themselves), log a loud
   warning line saying the demo reset ran.
3. **Seed.** After migrations and the config-admin setup, run the seeder,
   then continue normal startup.
4. **Password.** `SEED_PASSWORD` env var is the password for every seeded
   user (admin keeps `ADMIN_USER`/`ADMIN_PASS`). *My call:* if
   `SEED_DEMO=1` and `SEED_PASSWORD` is unset, startup fails with a clear
   error rather than inventing a password.
5. **Data set.**
   - **admin**: the config admin, unchanged.
   - **alice**: established reader. Verified email (`alice@example.com`),
     ~10 books including a 3-book series, a few rated, one with no cover, one
     with validation warnings, one with a pending metadata fix; a few books
     part-read, one finished, enough progress history for stats and the taste
     profile; a KoReader device she has access to; requests pending,
     fulfilled (linked to the book that satisfied it), declined (with reason).
   - **bob**: light user. Verified email, 2–3 books, one pending request.
   - **carol**: brand-new account, no email set (hits the "set your email"
     first-login flow), no books.
6. **Fixtures.** Real EPUBs committed under the server package (exact path
   left to the builder), copied into the runtime image. Edge-case books are
   derived from these at seed time.
7. **Coolify.** Set `SEED_DEMO=1` and `SEED_PASSWORD` on the "Bookplate
   (preview)" app only.

## Calls made after the builder check (Claude's, not the user's)

- **Placement.** The seeder runs inside the startup flow right after
  `ensureAdminUser` and before the startup library scan, sharing the
  `ThumbnailQueue`/`CoverBackfill` instances `index.ts` already builds, so
  covers and thumbnails are produced the normal way and the scan sees the
  seeded books as already imported.
- **Edge cases come from the real pipeline.** The validation warnings and the
  pending metadata fix must be what the import pipeline emits for the damaged
  derived EPUBs; if a chosen damage doesn't produce one, pick a different
  damage rather than inserting the row by hand. Where no service exists
  (ratings, device access, marking an email verified), a direct Prisma write
  is acceptable.
- **Dates are relative to seed time.** Progress history and reading events are
  backdated relative to "now" (e.g. spread over the last few weeks), so stats
  and streaks look the same after every deploy.
- **Wipe scope.** Both directories are emptied entirely, including the JWT
  secret and VAPID keys: everyone is logged out after each deploy, which is
  consistent with a reset. Guard: refuse to wipe (fail startup) if either path
  is `/`, they are equal, or one contains the other.
- **Failure.** Any seed error exits the process non-zero. Coolify then marks
  the deploy failed and keeps the previous container serving, which beats a
  half-seeded preview.
- **Fixtures.** The builder downloads the chosen Standard Ebooks EPUBs during
  implementation, checks each is CC0, and records the source URLs in a short
  README next to the fixtures.
- **Repeatability test.** Two wipe-and-seed runs give the same usernames, book
  titles and ids (book ids are content hashes), request states and progress
  states. User ids are random and are not compared.

## Left to the builder

- Which public-domain books (a natural 3-book series, e.g. Burroughs'
  Barsoom, is ideal), and the fixture directory.
- Whether series metadata comes from the EPUB or is set by the seed.
- How progress history is backdated, and how many entries.
- Seeder module layout, and tests: at minimum, the seed runs against a fresh
  DB without error and is idempotent across two consecutive starts; the gate
  is off unless `SEED_DEMO` is exactly `1`.
- README: a short note in the Coolify section about `SEED_DEMO` /
  `SEED_PASSWORD` and that they wipe data.
