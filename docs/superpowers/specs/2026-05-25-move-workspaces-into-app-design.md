# Move `server/` and `client/` into `app/` — Design

**Date:** 2026-05-25

## Summary

Move the two npm workspace directories (`server/` and `client/`) into a new top-level `app/` directory. Update Docker container working directories from `/app` to `/hass-odps` to avoid the path ambiguity that would otherwise arise (`/app/app/...`).

## Scope

### In scope
- `git mv server app/server` and `git mv client app/client`
- Root `package.json`: update workspace declarations and `start` script
- `server/index.ts`: update `packageJson` import path (`../` → `../../`)
- `Dockerfile`: update `WORKDIR`, all `COPY` paths, dist copy paths
- `Dockerfile.dev` (root): update `WORKDIR`, `COPY` paths
- `docker-compose.yml`: update volume mounts and `web` service build context
- `run.sh`: update entry point path

### Out of scope
- `client/Dockerfile.dev` — has its own `WORKDIR /app` for the Vite dev container; no naming conflict since it's a separate container
- All internal paths inside `server/` and `client/` — all relative, unaffected
- npm workspace `-w server` / `-w client` flags — use workspace `name` fields, not directory paths
- Historical spec/plan docs

---

## Directory Layout After

```
/
├── package.json          ← workspaces: ["app/server", "app/client"]
├── package-lock.json     ← regenerated after moves
├── app/
│   ├── server/           ← git mv server app/server
│   └── client/           ← git mv client app/client
├── Dockerfile
├── Dockerfile.dev
├── docker-compose.yml
└── run.sh
```

---

## File-by-File Changes

### `server/` and `client/`

```bash
mkdir app
git mv server app/server
git mv client app/client
```

### Root `package.json`

Two changes:
- `"workspaces"`: `["server", "client"]` → `["app/server", "app/client"]`
- `start` script: `node server/dist/index.js` → `node app/server/dist/index.js`

The `-w server` and `-w client` flags in all other scripts are unchanged — npm resolves workspaces by their `name` field (`hass-odps-server`, `hass-odps-client`), not their directory path.

### `server/index.ts`

```ts
// Before
import packageJson from '../package.json';
// After
import packageJson from '../../package.json';
```

One level deeper, so one extra `../`.

### `Dockerfile`

`WORKDIR /app` → `WORKDIR /hass-odps` in both build and production stages.

Build stage COPY changes:
- `COPY server/package*.json ./server/` → `COPY app/server/package*.json ./app/server/`
- `COPY client/package*.json ./client/` → `COPY app/client/package*.json ./app/client/`
- `COPY server/ ./server/` → `COPY app/server/ ./app/server/`
- `COPY client/index.html client/vite.config.ts client/tsconfig.json ./client/` → `COPY app/client/index.html app/client/vite.config.ts app/client/tsconfig.json ./app/client/`
- `COPY client/src/ ./client/src/` → `COPY app/client/src/ ./app/client/src/`

Production stage dist copies:
- `COPY --from=builder /app/server/dist ./server/dist` → `COPY --from=builder /hass-odps/app/server/dist ./app/server/dist`
- `COPY --from=builder /app/client/dist ./client/dist` → `COPY --from=builder /hass-odps/app/client/dist ./app/client/dist`

Production stage package copies:
- Same pattern as build stage (`app/server/`, `app/client/`)

### `Dockerfile.dev` (root)

`WORKDIR /app` → `WORKDIR /hass-odps`.

COPY changes:
- `COPY server/package*.json ./server/` → `COPY app/server/package*.json ./app/server/`
- `COPY client/package*.json ./client/` → `COPY app/client/package*.json ./app/client/`

### `docker-compose.yml`

API service volume:
- `./server:/app/server` → `./app/server:/hass-odps/app/server`

Web service build context:
- `context: ./client` → `context: ./app/client`

Web service volumes (client WORKDIR stays `/app` — its own container):
- `./client/src:/app/src` → `./app/client/src:/app/src`
- `./client/index.html:/app/index.html` → `./app/client/index.html:/app/index.html`
- `./client/vite.config.ts:/app/vite.config.ts` → `./app/client/vite.config.ts:/app/vite.config.ts`
- `./client/tsconfig.json:/app/tsconfig.json` → `./app/client/tsconfig.json:/app/tsconfig.json`

### `run.sh`

```sh
#!/usr/bin/env sh
set -e
exec node /hass-odps/app/server/dist/index.js
```

### Lockfile

After all moves, run `npm install` to regenerate `package-lock.json` with the updated workspace paths.

---

## What Does NOT Change

- `client/Dockerfile.dev` — separate container, `WORKDIR /app` has no conflict
- All files inside `server/` and `client/` (except `server/index.ts`)
- npm workspace script flags (`-w server`, `-w client`)
- `Makefile` — no source path references

---

## Verification

```bash
npm run lint
npm test
npm run build
```
