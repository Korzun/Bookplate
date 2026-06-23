## 1.2.9

- fix: prevent series Select dropdown from being clipped by card
- Cache cover images via immutable cache-busting URLs
- Cloudflare timeout hardening: request timeout, progress pagination, async scan

## 1.2.8

- fix: series in-progress only when a book is actively being read

## 1.2.7

- feat: validate author sort and title sort format in book edit
- fix: error loading book after adding to new series via metadata edit
- Visual nitpicks: settings icon, skip user list for non-admins
- feat: series name field uses searchable select with create support
- feat: add configurable library name

## 1.2.6

- Admin user library selector

## 1.2.5

- feat: mobile browser compatibility

## 1.2.4

- feat: generate password server-side on user creation, require change on first login
- chore(deps): bump the npm_and_yarn group across 1 directory with 4 updates

## 1.2.3

- feat: add surrogate NanoID primary key to users table
- feat: self-service password change, sync/login split, and admin password reset
- refactor: replace per-component toast state with ToastProvider + useToast
- feat: switch web UI auth from sessions to JWTs with rotating refresh tokens
- fix: reset bootstrapped ref on cleanup to unblock loading in StrictMode
- fix: authenticated cover image loading via useAuthorizedSrc hook
- fix: decode HTML entities in chapter titles from nav/NCX
- feat: Add LoadingPage, improve UI nitpicks
- Per-user libraries
- feat: improve alignment and function of buttons on book page
- feat: progress history — record sync dwell events per book
- feat: infinite-scroll library pagination with Series index
- feat: rename fileAs to titleSort, add authorSort and publishDate to book metadata
- feat: subject chip typeahead in book edit form
- feat: add type and status filters to Library page
- feat: series aggregate metadata (subjects, bookCount, author, publisher, totalPages)
- feat: redesign SyncPassword display as token pill
- fix: allow SubjectChips dropdown to escape Card overflow clipping
- feat: show loading spinner in LibraryPage during initial load
- feat: add Select combobox control with subject filter
- feat: add radius prop to Button; lighten card backgrounds
- feat: replace native selects in filter-bar with custom Select
- fix: clear-button height and subject filter param
- fix: wire subject filter end-to-end through server and pagination
- feat: CoverImagePicker — polished cover image upload with thumbnail preview
- feat: replace FilterBar with type-ahead SearchBar
- fix: search bar QA fixes
- Search, filters, series metadata, and cover thumbnail improvements
- feat: expand OPDS catalog with Author, Series, Subject, and Status browse feeds
- fix: correct default thumbnail width and add run-tests skill
- fix: rename JWT settings key from jwtSecret to jwt_secret
- fix: silence React Router future flag, JSS, and act warnings in client tests

## 1.3.0

- feat: switch Web UI authentication from server-side sessions to JWTs with rotating refresh tokens. All users are logged out once by this upgrade and must sign in again. OPDS and KOSync authentication are unchanged.

## 1.2.2

- chore: add CodeRabbit configuration
- fix: preserve progress cache and fix regen-chapters 404 when book id changes
- feat: delete synced reading progress
- chore(deps): bump react-router from 6.30.3 to 6.30.4 in the npm_and_yarn group across 1 directory
- feat: add fontFamily tokens to Theme
- feat: book lineage link/unlink for orphaned progress

## 1.2.1

- chore: devcontainer improvements for Zed + Claude Code
- chore: complete Prisma migration — services and data migration tracking
- Feat: Track book ID lineage to keep KOSync progress in sync across edits and reimports
- feat: beta channel follows stable releases
- chore: ignore Claude worktree directory
- feat: admin book ID lineage card
- fix: add concurrency guard to Release workflow

## 1.2.0

- chore: upgrade supertest v6 → v7
- feat: migrate data layer to Prisma ORM with Migrate baseline
- feat: login page updates
- refactor: extract calculateSeriesProgressPercent and fix useMySeriesProgress
- fix: disable moby in docker-outside-of-docker devcontainer feature
- feat: show series name inline with the book title on the book page
- chore: generate HA-compatible CHANGELOG.md on release
- feat: Add "Not Started" and "Completed" detents to set progress slider
- feat: add Regen Chapters admin button on book page
- fix: EPUB corruption when writing metadata to files with ZIP data descriptors
- feat: expose device, device_id, timestamp, and progress CFI in sync progress API
- feat: add beta release channel for RC releases
- chore: update Docker actions to Node 24 compatible versions

