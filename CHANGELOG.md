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

