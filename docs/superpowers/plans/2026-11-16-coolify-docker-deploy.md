# Coolify / Plain Docker Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bookplate deploys as a plain Docker container (Coolify Dockerfile build pack, or `docker compose up -d`) with a health check, safe env handling, and its own icon and domain in Coolify's list.

**Architecture:** No new runtime pieces. `config.ts` treats blank env vars as unset; the UI router gains an unauthenticated `GET /api/health`; the Dockerfile gains a `HEALTHCHECK` and OCI labels; the dev compose file moves aside so the root `docker-compose.yml` is a deployable one, mirroring `~/code/scribe-server`.

**Tech Stack:** Node 24, Express 5, Prisma (better-sqlite3 adapter), Vitest + supertest, Docker / Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-coolify-docker-deploy-design.md`

## Global Constraints

- The Home Assistant add-on is unchanged: `config.yaml`, `run.sh`, release workflows' build/push jobs, and `options.json` handling keep working.
- Precedence stays **env var → `options.json` → default**; a blank or whitespace-only env var counts as unset.
- No curl/wget added to the runtime image; the health check uses `node -e fetch(...)`.
- Health check timing: `--interval=30s --timeout=5s --start-period=10s --retries=3` (Scribe's).
- The container still runs as root (no privilege drop — non-goal).
- No published GHCR image, no change to release build/push jobs.

## Review Focus

1. **`ADMIN_PASS` left blank in `.env` / Coolify** → admin password stays `changeme` (or the add-on option), never the empty string. Test in Task 1.
2. **`PORT` or `DATA_DIR` blank** → `3000` and `/data`, not `NaN` / `''`-relative paths. Test in Task 1.
3. **Database unreachable while the process is up** → `/api/health` answers `503`, so Coolify marks it unhealthy instead of routing to it. Test in Task 2.
4. **A logged-out client (Coolify's favicon fetch)** gets `/favicon.ico` as an image, not the SPA's `index.html`. CI check in Task 3.
5. **`make dev` / `make dev-down` after the compose rename** still bring the dev stack up and down under the `bookplate-dev` project. Verified in Task 4.

---

### Task 1: Blank env vars count as unset

**Files:**
- Modify: `app/server/config.ts` (`loadConfig`, add helper)
- Test: `app/server/config.test.ts`

**Interfaces:**
- Produces: module-private `envVar` in `config.ts` — `undefined` when the var is missing or blank. Every `process.env.X` read in `loadConfig` goes through it (`DATA_DIR`, `LIBRARY_NAME`, `ADMIN_USER`, `ADMIN_PASS`, `BOOKS_DIR`, `PORT`, `VALIDATION_THRESHOLD`, `TRUST_PROXY_HOPS`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `PUBLIC_URL`).
- Signature: `envVar(name: string, opts?: { trim?: boolean }): string | undefined`. Blank check always trims; with `trim: false` a non-blank value is returned raw. Only `ADMIN_PASS` uses `trim: false` (spaces are legitimate in a password).

- [ ] **Step 1: Write the failing tests** — new `describe('loadConfig blank env vars')`:

```ts
it('falls back to the add-on option when ADMIN_PASS is blank', () => {
  writeOptions({ password: 'from-options' });
  process.env.ADMIN_PASS = '';
  expect(loadConfig().password).toBe('from-options');
});
it('falls back to the default when ADMIN_USER / ADMIN_PASS are whitespace', () => {
  process.env.ADMIN_USER = '  ';
  process.env.ADMIN_PASS = ' ';
  const c = loadConfig();
  expect(c.username).toBe('admin');
  expect(c.password).toBe('changeme');
});
it('keeps a non-blank ADMIN_PASS exactly, spaces included', () => {
  process.env.ADMIN_PASS = ' s3cret ';
  expect(loadConfig().password).toBe(' s3cret ');
});
it('defaults PORT to 3000 when blank', () => {
  process.env.PORT = '';
  expect(loadConfig().port).toBe(3000);
});
it('defaults DATA_DIR to /data when blank', () => {
  process.env.DATA_DIR = '';
  expect(loadConfig().dataDir).toBe('/data');
});
it('resolves library_dir when BOOKS_DIR is blank', () => {
  writeOptions({ library_dir: 'fiction' });
  process.env.BOOKS_DIR = '';
  expect(loadConfig().booksDir).toBe('/media/fiction');
});
it('uses the option when VALIDATION_THRESHOLD is blank', () => {
  writeOptions({ validation_threshold: 'Warning' });
  process.env.VALIDATION_THRESHOLD = '';
  expect(loadConfig().validationThreshold).toBe('WARNING');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/server -- config.test.ts`
Expected: the new tests FAIL (e.g. `password` is `''`, `port` is `NaN`); existing tests pass.

- [ ] **Step 3: Implement `envVar` and route every `process.env` read in `loadConfig` through it**

`ADMIN_PASS` uses `envVar('ADMIN_PASS', { trim: false })`. Update the `TRUST_PROXY_HOPS` doc comment's "env vars are always strings" line only if it becomes wrong (it doesn't).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w app/server -- config.test.ts` → all PASS. Then `npm run lint -w app/server` → clean.

- [ ] **Step 5: Commit**

```bash
git add app/server/config.ts app/server/config.test.ts
git commit -m "fix(config): treat blank env vars as unset so an empty ADMIN_PASS can't blank the admin password"
```

---

### Task 2: `GET /api/health`

**Files:**
- Modify: `app/server/routes/ui.ts` (next to `/api/public-config`, ~line 598)
- Test: `app/server/routes/ui.test.ts` (new `describe('GET /api/health')` after the public-config block)

**Interfaces:**
- Produces: `GET /api/health`, unauthenticated. `200 {"ok":true}` when `prisma.$queryRaw\`SELECT 1\`` resolves; `503 {"ok":false}` when it rejects (log the error at `warn` via the router's existing `log`). Responds with `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('GET /api/health', () => {
  it('answers 200 ok without a session when the database responds', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 503 when the database query fails', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('db gone'));
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false });
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/server -- routes/ui.test.ts -t "GET /api/health"`
Expected: FAIL (404 → SPA catch-all / not 200 JSON).

- [ ] **Step 3: Add the route in `createUiRouter`, before any auth middleware**

- [ ] **Step 4: Run to verify they pass**

Run the same command → PASS; then `npm test -w app/server` and `npm run lint -w app/server` → green.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat(server): unauthenticated /api/health that checks the database"
```

---

### Task 3: Image health check, labels, and CI smoke checks

**Files:**
- Modify: `Dockerfile` (runtime stage, before `EXPOSE`/`CMD`)
- Modify: `.github/workflows/ci.yml` (`docker-smoke-test` job)
- Modify: `.github/workflows/release-publish.yml` (`docker-smoke-test` job — same additions)

**Interfaces:**
- Consumes: `GET /api/health` from Task 2.
- Produces: image `HEALTHCHECK` and labels:

```dockerfile
ARG VERSION=dev
LABEL org.opencontainers.image.title="Bookplate" \
      org.opencontainers.image.description="OPDS catalog, KOSync progress sync and web library manager for KoReader" \
      org.opencontainers.image.source="https://github.com/Korzun/Bookplate" \
      org.opencontainers.image.version="${VERSION}"
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
```

Check the HA builder doesn't already set conflicting `org.opencontainers.image.*` labels via build args; if it passes `BUILD_VERSION`, leave `VERSION` defaulting to `dev` (no workflow change).

- [ ] **Step 1: Add smoke steps** to both workflows' smoke job, after the existing readiness loop (and, in `ci.yml`, after the DB check):
  - **Health:** poll `docker inspect -f '{{.State.Health.Status}}' smoke-test` up to 30× at 2s until `healthy`; on timeout print status + `docker logs` and fail. (The 10s start period plus first 30s interval would be too slow — run the container with `--health-interval=2s` on the `docker run` line so the check fires quickly in CI.)
  - **Favicon:** `curl -sf -o /dev/null -w '%{content_type}' http://localhost:3000/favicon.ico` must start with `image/`; otherwise fail with logs.
  - `curl -sf http://localhost:3000/api/health` returns `{"ok":true}`.

- [ ] **Step 2: Add the `LABEL`/`HEALTHCHECK` block to the Dockerfile.**

- [ ] **Step 3: Verify locally** (the Pi builds arm64 natively):

```bash
docker build -t bookplate:health .
docker run -d --name bp-health --health-interval=2s -p 3999:3000 bookplate:health
sleep 15; docker inspect -f '{{.State.Health.Status}}' bp-health   # → healthy
curl -s localhost:3999/api/health                                   # → {"ok":true}
curl -s -o /dev/null -w '%{content_type}\n' localhost:3999/favicon.ico  # → image/...
docker rm -f bp-health
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .github/workflows/ci.yml .github/workflows/release-publish.yml
git commit -m "build: image health check and OCI labels; smoke test checks health and the favicon"
```

---

### Task 4: Deployable `docker-compose.yml`; dev stack moves to `docker-compose.dev.yml`

**Files:**
- Rename: `docker-compose.yml` → `docker-compose.dev.yml` (`git mv`, contents unchanged; keeps `name: bookplate-dev`)
- Modify: `scripts/dev-compose.mjs:76` — spawn `['compose', '-f', 'docker-compose.dev.yml', ...args]`
- Modify: `Makefile` `dev-clean` — `docker compose -f docker-compose.dev.yml down --rmi all -v`
- Create: `docker-compose.yml`, `.env.example`

**Interfaces:**
- Produces: root `docker-compose.yml` (header comment like Scribe's: copy `.env.example` to `.env`, fill in, `docker compose up -d`; dev stack is `docker-compose.dev.yml`):

```yaml
services:
  bookplate:
    build: .
    image: bookplate:local
    pull_policy: build
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    environment:
      ADMIN_USER: ${ADMIN_USER:-}
      ADMIN_PASS: ${ADMIN_PASS:-}
      LIBRARY_NAME: ${LIBRARY_NAME:-}
      PUBLIC_URL: ${PUBLIC_URL:-}
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-0}
      VALIDATION_THRESHOLD: ${VALIDATION_THRESHOLD:-}
      CF_ACCOUNT_ID: ${CF_ACCOUNT_ID:-}
      CF_API_TOKEN: ${CF_API_TOKEN:-}
      EMAIL_FROM: ${EMAIL_FROM:-}
      EMAIL_FROM_NAME: ${EMAIL_FROM_NAME:-}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      BOOKS_DIR: /media/books
    volumes:
      - bookplate-data:/data
      - bookplate-books:/media/books
volumes:
  bookplate-data:
  bookplate-books:
```

  Comment that `bookplate-books` can be swapped for a host path (`- /srv/books:/media/books`). Blank values are safe because of Task 1.
- `.env.example`: every variable above with a one-line comment; `ADMIN_PASS=` with "set this before first start — blank means the insecure default `changeme`".

- [ ] **Step 1: Make the rename and script/Makefile edits.**
- [ ] **Step 2: Verify dev scripts:** `npm run test:scripts` → PASS; `docker compose -f docker-compose.dev.yml config -q` → exit 0.
- [ ] **Step 3: Create `docker-compose.yml` and `.env.example`.**
- [ ] **Step 4: Verify prod compose:** `docker compose config -q` → exit 0; `ADMIN_PASS=x docker compose up -d --build`, wait for `docker compose ps` to show `healthy`, `curl -s localhost:3000/api/health` → `{"ok":true}`; `docker compose down -v`.
- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml .env.example scripts/dev-compose.mjs Makefile
git commit -m "build: deployable docker-compose.yml with .env.example; dev stack moves to docker-compose.dev.yml"
```

---

### Task 5: README — Docker and Coolify

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Intro** (line ~14): Bookplate runs as a Home Assistant add-on **or** a plain Docker container.
- [ ] **Step 2: New `## Running with Docker` section** after the add-on section: `cp .env.example .env`, set `ADMIN_PASS`, `docker compose up -d`; volumes `/data` (DB, thumbnails) and `/media/books` (library); config via the env table.
- [ ] **Step 3: New `## Deploying on Coolify` subsection**, adapted from `~/code/scribe-server/README.md` "Deploying on Coolify":
  1. New resource → Git repository, branch `main`, **Dockerfile** build pack, port `3000`. Say why not Docker Compose: with the Dockerfile pack the domain lives on the application, so Coolify's list shows the domain and Bookplate's favicon.
  2. Domain — same tunnel `http` vs `https` guidance as Scribe.
  3. Env vars: `ADMIN_PASS` (secret), `PUBLIC_URL` (the https origin; turns on MCP), `TRUST_PROXY_HOPS=2` behind a tunnel in front of Coolify's proxy, `1` for the proxy alone; optional email vars.
  4. Persistent storage: volumes at `/data` and `/media/books` (or a host directory for an existing library).
  5. Deploy — Coolify builds on the server and waits for the image's health check (`/api/health`).
- [ ] **Step 4: Env table** (line ~281): retitle "Environment variables (Docker / dev / bare-metal)", add `VALIDATION_THRESHOLD` (`Error`; `Fatal|Error|Warning|Info`), note "a variable set to the empty string counts as unset".
- [ ] **Step 5: Development section:** `make dev` uses `docker-compose.dev.yml`.
- [ ] **Step 6: Verify** `npx oxfmt --check README.md` (or the repo's formatter per `.oxfmtrc.json`) passes; commit.

```bash
git add README.md
git commit -m "docs: run Bookplate with Docker and deploy it on Coolify"
```
