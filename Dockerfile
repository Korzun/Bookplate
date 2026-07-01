# ── builder ─────────────────────────────────────────────────────────────────
# Pinned to the host build platform so Node.js 24 never runs under QEMU.
# (Node.js 24 / V8 uses ARMv8.3-A instructions that QEMU on GitHub Actions
# cannot emulate, causing SIGILL / exit 132 on any npm invocation.)
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder
WORKDIR /hass-odps

# Install all workspace deps
COPY package*.json ./
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
RUN rm package-lock.json && npm install

# Backend source
COPY app/server/ ./app/server/

# Client source
COPY app/client/index.html app/client/vite.config.ts app/client/tsconfig.json ./app/client/
COPY app/client/src/ ./app/client/src/

# Build everything
RUN npm run build

# ── prod-deps ────────────────────────────────────────────────────────────────
# Also runs on the host platform (no QEMU). We translate the target arch into
# npm's naming and pass two overrides so native packages are fetched for the
# *target* architecture rather than the build host:
#   npm_config_arch  → used by prebuild-install to download the correct
#                      prebuilt binary (e.g. better-sqlite3 musl-arm64).
#   --cpu            → used by npm to filter optional dependencies by cpu
#                      field (e.g. installs @img/sharp-linuxmusl-arm64
#                      instead of the x64 variant on an amd64 build host).
# Docker's TARGETARCH uses "amd64"; npm/Node use "x64" – we translate below.
FROM --platform=$BUILDPLATFORM node:24-alpine AS prod-deps
ARG TARGETARCH
WORKDIR /hass-odps

COPY package*.json ./
COPY package.json ./app/package.json
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
# ARGON2=1 skips node-gyp-build's install-time prebuild load-test for argon2:
# that test dlopen()s the resolved prebuild to verify it works, which fails
# when cross-compiling (an arm64 .node file can't be loaded by the amd64
# build host's Node), causing it to fall back to `node-gyp rebuild` (which
# then fails because alpine has no Python). Skipping the test still leaves
# node-gyp-build's runtime loader to pick the correct linux-arm64 musl
# prebuild when the app actually runs on the target platform.
RUN NPMARCH=$([ "${TARGETARCH}" = "amd64" ] && echo "x64" || echo "${TARGETARCH}") && \
    ARGON2=1 npm_config_arch=${NPMARCH} npm ci --cpu=${NPMARCH} --omit=dev && \
    npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────────────────
# Target-platform image. No npm/node commands run here during the build, so
# QEMU is never asked to execute Node.js – only COPY and chmod, which Docker
# handles natively.
FROM node:24-alpine
WORKDIR /hass-odps

COPY package.json ./
COPY package.json ./app/package.json
COPY app/server/package.json ./app/server/
COPY app/client/package.json ./app/client/

COPY --from=prod-deps /hass-odps/node_modules ./node_modules

COPY --from=builder /hass-odps/app/server/dist ./app/server/dist
COPY --from=builder /hass-odps/app/server/prisma ./app/server/prisma
# .prisma/client/ contains the generated Prisma JS client (pure JS, no
# platform-specific binary when using the adapter-better-sqlite3 approach).
COPY --from=builder /hass-odps/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /hass-odps/app/client/dist ./app/client/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3000
CMD ["/run.sh"]
