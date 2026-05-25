# Rename `/app` to `/server`

**Date:** 2026-05-25

## Summary

Rename the backend source directory from `app/` to `server/` to better reflect its role (Express server, not a generic "app"), and update all references across config files.

## Scope

### In scope
- Rename `app/` directory to `server/` via `git mv`
- Update all 6 config files that reference the directory by name

### Out of scope
- Historical spec/plan docs under `docs/superpowers/` — kept as-is as frozen artifacts
- CI workflow files — no references to the directory

## Changes

### Step 1 — Directory rename
```
git mv app server
```

### Step 2 — Config file updates

| File | Change |
|---|---|
| `package.json` | `--watch app` → `--watch server`; `app/index.ts` → `server/index.ts` |
| `tsconfig.json` | `rootDir`, `include`, and `exclude`: `app` → `server` |
| `jest.config.js` | `roots: ['<rootDir>/app']` → `roots: ['<rootDir>/server']` |
| `Dockerfile` | `COPY app/ ./app/` → `COPY server/ ./server/` |
| `docker-compose.yml` | `./app:/app/app` → `./server:/app/server` |
| `eslint.config.mjs` | `app/**/*.ts` → `server/**/*.ts` (and the comment above it) |

## What does NOT change

- `WORKDIR /app` in Dockerfiles — this is the container's working directory, unrelated to the source folder name
- TypeScript imports inside the directory — all relative paths, unaffected by directory rename
- CI workflow files — no references to the source directory

## Verification

After the rename, run `npm run lint` and `npm test` to confirm all paths resolve correctly.
