# Move Workspaces into `app/` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `server/` and `client/` into a new top-level `app/` directory and update all references so the project builds and tests pass.

**Architecture:** Use `git mv` to preserve history, update root `package.json` workspaces array and all `-w` script flags, change Docker WORKDIR from `/app` to `/hass-odps` to avoid the path collision that would arise from `/app/app/...`, and update all path references in `server/index.ts`, `Dockerfile`, `Dockerfile.dev`, `docker-compose.yml`, and `run.sh`.

**Tech Stack:** npm workspaces, TypeScript, Docker multi-stage builds, docker-compose

---

## File Map

| File | Change |
|------|--------|
| `server/` → `app/server/` | `git mv` |
| `client/` → `app/client/` | `git mv` |
| `package.json` | workspaces array, all `-w` flags, `start` script |
| `app/server/index.ts` | `../package.json` → `../../package.json` |
| `Dockerfile` | WORKDIR, all COPY paths, dist copy paths |
| `Dockerfile.dev` | WORKDIR, COPY paths |
| `docker-compose.yml` | API volume, web build context + volumes |
| `run.sh` | node invocation path |

---

### Task 1: Move directories, update `package.json` and `server/index.ts`, regenerate lockfile

**Files:**
- Move: `server/` → `app/server/`
- Move: `client/` → `app/client/`
- Modify: `package.json`
- Modify: `app/server/index.ts`
- Regenerate: `package-lock.json`

- [ ] **Step 1: Create `app/` directory and move workspaces**

```bash
mkdir app
git mv server app/server
git mv client app/client
```

Expected: `git status` shows `renamed: server/... -> app/server/...` and `renamed: client/... -> app/client/...` for all files in those directories.

- [ ] **Step 2: Update root `package.json`**

Replace the full file contents with:

```json
{
  "name": "hass-odps",
  "version": "1.1.2",
  "private": true,
  "workspaces": ["app/server", "app/client"],
  "scripts": {
    "build": "npm run build -w app/server && npm run build -w app/client",
    "start": "node app/server/dist/index.js",
    "dev": "npm run dev -w app/server",
    "dev:client": "npm run dev -w app/client",
    "test": "npm test -w app/server",
    "test:watch": "npm run test:watch -w app/server",
    "lint": "npm run lint -w app/server && npm run lint -w app/client",
    "lint:fix": "npm run lint:fix -w app/server && npm run lint:fix -w app/client"
  }
}
```

Note: npm `-w` flags match workspace directory paths (not `name` fields), so all `-w server` → `-w app/server` and all `-w client` → `-w app/client`.

- [ ] **Step 3: Update `server/index.ts` import path**

File is now at `app/server/index.ts`. Change line 10:

```ts
// Before
import packageJson from '../package.json';
// After
import packageJson from '../../package.json';
```

- [ ] **Step 4: Regenerate the lockfile**

```bash
npm install
```

Expected: `package-lock.json` regenerated with workspace paths `app/server` and `app/client`. No errors.

- [ ] **Step 5: Run tests to verify nothing broke**

```bash
npm test
```

Expected: all server tests pass. (SQLite-related failures in the test environment are pre-existing noise and can be ignored if they were already failing before this change.)

- [ ] **Step 6: Commit**

```bash
git add app/ package.json package-lock.json
git commit -m "refactor: move server/ and client/ into app/ directory"
```

---

### Task 2: Update `Dockerfile`

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Update `Dockerfile`**

Replace the full file contents with:

```dockerfile
# Build stage
FROM node:24-alpine AS builder
WORKDIR /hass-odps

# Install all workspace deps
COPY package*.json ./
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
RUN npm ci

# Backend source
COPY app/server/ ./app/server/

# Client source
COPY app/client/index.html app/client/vite.config.ts app/client/tsconfig.json ./app/client/
COPY app/client/src/ ./app/client/src/

# Build everything
RUN npm run build

# Production stage
FROM node:24-alpine
WORKDIR /hass-odps

COPY package*.json ./
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /hass-odps/app/server/dist ./app/server/dist
COPY --from=builder /hass-odps/app/client/dist ./app/client/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3000
CMD ["/run.sh"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "refactor(docker): update Dockerfile for app/ workspace layout"
```

---

### Task 3: Update `Dockerfile.dev`, `docker-compose.yml`, and `run.sh`

**Files:**
- Modify: `Dockerfile.dev`
- Modify: `docker-compose.yml`
- Modify: `run.sh`

- [ ] **Step 1: Update root `Dockerfile.dev`**

Replace the full file contents with:

```dockerfile
FROM node:24-alpine
WORKDIR /hass-odps

COPY package*.json ./
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
RUN npm ci

EXPOSE 3000
CMD ["npm", "run", "dev"]
```

- [ ] **Step 2: Update `docker-compose.yml`**

Replace the full file contents with:

```yaml
name: hass-odps-dev

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - ./app/server:/hass-odps/app/server
      - ${BOOKS:-./dev-books}:/media/books
      - ./dev-data:/data
    environment:
      ADMIN_USER: ${ADMIN_USER:-admin}
      ADMIN_PASS: ${ADMIN_PASS:-changeme}
      BOOKS_DIR: /media/books
    ports:
      - "3000:3000"

  web:
    build:
      context: ./app/client
      dockerfile: Dockerfile.dev
    volumes:
      - ./app/client/src:/app/src
      - ./app/client/index.html:/app/index.html
      - ./app/client/vite.config.ts:/app/vite.config.ts
      - ./app/client/tsconfig.json:/app/tsconfig.json
    environment:
      API_URL: http://api:3000
      DOCKER: "true"
    ports:
      - "5173:5173"
    depends_on:
      - api
```

Note: The `web` service volumes still use `/app/...` on the container side — that's correct. `client/Dockerfile.dev` has its own `WORKDIR /app` and is a separate container; no naming collision exists there.

- [ ] **Step 3: Update `run.sh`**

Replace the full file contents with:

```sh
#!/usr/bin/env sh
set -e
exec node /hass-odps/app/server/dist/index.js
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile.dev docker-compose.yml run.sh
git commit -m "refactor(docker): update dev config for app/ workspace layout"
```

---

### Task 4: Final verification

**Files:** none modified

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: exits 0, no errors.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all server tests pass.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: exits 0. `app/server/dist/` and `app/client/dist/` are populated.

- [ ] **Step 4: Verify dist output location**

```bash
ls app/server/dist/index.js app/client/dist/index.html
```

Expected: both files exist.
