# Deploy Bookplate as a plain Docker container (Coolify)

## Intent

Run Bookplate on Coolify alongside the Home Assistant add-on, the same way the
Scribe server already runs there: Coolify builds the image from this Git
repository and deploys it. The add-on keeps working unchanged.

## Goals

- `docker compose up -d` from a checkout (and Coolify's Docker Compose build
  pack) runs a production Bookplate with persistent data and library volumes.
- Coolify knows when a deploy is healthy.
- README has a "Deploying on Coolify" section that mirrors Scribe's.

## Non-goals

- Publishing a generic multi-arch image to GHCR (option 2, not chosen).
- Dropping root inside the container (Scribe does this; Bookplate writes into
  an existing book library whose ownership we'd have to take over — separate change).
- Any change to the add-on's `config.yaml`, release workflows, or options.

## Approaches considered

1. **Coolify builds from Git** — compose file + healthcheck + docs, no CI change.
   Deploys build on the server. **Chosen** (matches Scribe).
2. **Coolify pulls a published image** — fast deploys, needs a new release job.

## Design (mirrors scribe-server)

1. **Dev compose moves** to `docker-compose.dev.yml`; `scripts/dev-compose.mjs`
   and `Makefile` pass `-f docker-compose.dev.yml`.
2. **New root `docker-compose.yml`**: one `bookplate` service, `build: .`,
   `pull_policy: build`, `restart: unless-stopped`, port `${PORT:-3000}:3000`,
   env `ADMIN_USER`, `ADMIN_PASS`, `LIBRARY_NAME`, `PUBLIC_URL`,
   `TRUST_PROXY_HOPS`, `VALIDATION_THRESHOLD`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`,
   `EMAIL_FROM`, `EMAIL_FROM_NAME`, `LOG_LEVEL`; named volumes
   `bookplate-data:/data` and `bookplate-books:/media/books` (with `BOOKS_DIR`
   fixed to `/media/books`). Plus `.env.example`.
3. **Empty env var = unset** in `app/server/config.ts`. Today it uses `??`, so a
   compose line like `ADMIN_PASS: ${ADMIN_PASS:-}` would set an *empty admin
   password*. Blank values fall through to the add-on option / default, as in
   Scribe. Covered by `config.test.ts`.
4. **Health check**: new unauthenticated `GET /api/health` that runs a trivial
   Prisma query and returns `200 {"ok":true}` (`503` if the DB fails). Dockerfile
   gets a `HEALTHCHECK` calling it with `node -e fetch(...)` (no curl in image)
   and OCI labels. CI smoke test also checks the container reports `healthy`.
5. **README**: "Deploying on Coolify" (Git repo → Compose build pack, domain /
   tunnel note, `PUBLIC_URL` https origin, `TRUST_PROXY_HOPS` 1 or 2,
   `ADMIN_PASS` as a secret, storage at `/data` and `/media/books`), and env
   table gains `VALIDATION_THRESHOLD`; the "Development" section points at the
   dev compose file.

## Left to the builder

Exact healthcheck intervals (copy Scribe's: 30s/5s/10s start/3 retries), README wording.
