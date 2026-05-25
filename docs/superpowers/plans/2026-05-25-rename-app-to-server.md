# Rename `app/` to `server/` + npm Workspaces Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the backend source directory from `app/` to `server/` and restructure the project as an npm workspaces monorepo, with workspace-scoped config files replacing the current root-level ones.

**Architecture:** `app/` is renamed via `git mv` to preserve file history. Root-level config files (`tsconfig.json`, `jest.config.js`, `eslint.config.mjs`) dissolve into workspace-specific equivalents living inside `server/` and `client/`. Root `package.json` becomes a thin workspace root with orchestration scripts and no deps of its own. npm workspaces hoists all dependencies into a single root `node_modules` and a single root `package-lock.json`.

**Tech Stack:** npm workspaces (npm v7+), TypeScript, Jest/ts-jest, ESLint 9 (flat config), Nodemon, Docker multi-stage builds.

---

## File Map

| File | Action |
|---|---|
| `app/` | `git mv` → `server/` |
| `package.json` | Task 1: update scripts; Task 2: rewrite to workspace root |
| `tsconfig.json` | Task 1: update paths; Task 2: `git mv` → `server/tsconfig.json` + update |
| `jest.config.js` | Task 1: update roots; Task 2: `git mv` → `server/jest.config.js` + update |
| `eslint.config.mjs` | Task 1: update file glob; Task 3: delete |
| `server/package.json` | Task 2: create |
| `server/eslint.config.mjs` | Task 3: create |
| `client/package.json` | Task 3: add eslint devDeps |
| `client/eslint.config.mjs` | Task 3: create |
| `client/package-lock.json` | Task 2: delete |
| `run.sh` | Task 2: update entry point |
| `Dockerfile` | Task 4: update package copy + dist paths |
| `Dockerfile.dev` | Task 4: update package copy, remove tsconfig |
| `docker-compose.yml` | Task 1: update volume mount |

---

## Task 1: Rename `app/` → `server/` and update root config file paths

Root config files (`tsconfig.json`, `jest.config.js`, `eslint.config.mjs`) stay at the root in this task — they are only updated to reference `server/` instead of `app/`. They move into the workspace in Task 2.

**Files:**
- Rename: `app/` → `server/`
- Modify: `package.json` (dev script)
- Modify: `tsconfig.json` (rootDir, include, exclude)
- Modify: `jest.config.js` (roots)
- Modify: `eslint.config.mjs` (file glob + comment)
- Modify: `Dockerfile` (COPY source line)
- Modify: `docker-compose.yml` (volume mount)

- [ ] **Step 1: Verify tests and lint pass before making any changes**

```bash
npm test
npm run lint
```

Expected: all tests pass, lint exits 0.

- [ ] **Step 2: Rename the directory**

```bash
git mv app server
```

- [ ] **Step 3: Update `package.json` dev script**

Change the `dev` script in `package.json` from:
```json
"dev": "nodemon --watch app --ext ts,json --exec 'ts-node --project tsconfig.json' app/index.ts",
```
to:
```json
"dev": "nodemon --watch server --ext ts,json --exec 'ts-node --project tsconfig.json' server/index.ts",
```

- [ ] **Step 4: Update `tsconfig.json`**

Replace the full file content with:
```json
{
  "ts-node": {
    "files": true
  },
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./server",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules", "dist", "server/**/*.test.ts"]
}
```

Note: `outDir: "./dist"` is unchanged — compiled output still goes to root `dist/` in this intermediate state.

- [ ] **Step 5: Update `jest.config.js`**

Replace the full file content with:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/server'],
  testMatch: ['**/*.test.ts'],
};
```

- [ ] **Step 6: Update `eslint.config.mjs` — server file glob and comment**

Change the comment and `files` pattern in the server section from:
```js
  // Server (app/)
  {
    files: ["app/**/*.ts"],
```
to:
```js
  // Server (server/)
  {
    files: ["server/**/*.ts"],
```

- [ ] **Step 7: Update `Dockerfile` COPY line**

Change:
```dockerfile
COPY app/ ./app/
```
to:
```dockerfile
COPY server/ ./server/
```

- [ ] **Step 8: Update `docker-compose.yml` volume mount**

Change:
```yaml
      - ./app:/app/app
```
to:
```yaml
      - ./server:/app/server
```

- [ ] **Step 9: Verify tests and lint pass**

```bash
npm test
npm run lint
```

Expected: all tests pass, lint exits 0.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json jest.config.js eslint.config.mjs Dockerfile docker-compose.yml
git commit -m "refactor: rename app/ to server/ and update config paths"
```

---

## Task 2: Move config files into `server/`, create `server/package.json`, convert root to workspace root

This task restructures the repo into an npm workspaces monorepo. After this task: `npm test` and `npm run lint -w server` use workspace scripts; compiled output moves to `server/dist/`.

**Files:**
- Move: `tsconfig.json` → `server/tsconfig.json` (then edit)
- Move: `jest.config.js` → `server/jest.config.js` (then edit)
- Create: `server/package.json`
- Rewrite: `package.json` (workspace root)
- Delete: `client/package-lock.json`
- Modify: `run.sh`

- [ ] **Step 1: Move `tsconfig.json` into `server/`**

```bash
git mv tsconfig.json server/tsconfig.json
```

- [ ] **Step 2: Update `server/tsconfig.json` — adjust paths for its new location**

Replace the full file content with:
```json
{
  "ts-node": {
    "files": true
  },
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["./**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

Key changes from root version:
- `rootDir`: `"./server"` → `"."` (tsconfig now lives inside server/)
- `outDir`: stays `"./dist"` but now resolves to `server/dist/`
- `include`: `"server/**/*"` → `"./**/*"`
- `exclude`: `"server/**/*.test.ts"` → `"**/*.test.ts"`

The import `import packageJson from '../package.json'` in `server/index.ts` still resolves to the root `package.json` — no change needed.

- [ ] **Step 3: Move `jest.config.js` into `server/`**

```bash
git mv jest.config.js server/jest.config.js
```

- [ ] **Step 4: Update `server/jest.config.js`**

Replace the full file content with:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
};
```

`<rootDir>` in Jest resolves to the directory containing the config file — i.e., `server/`. No need to prefix it.

- [ ] **Step 5: Create `server/package.json`**

Create `server/package.json` with this exact content (all values copied from root `package.json`, minus the four packages that belong to the client eslint config):
```json
{
  "name": "hass-odps-server",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "nodemon --watch . --ext ts,json --exec 'ts-node --project tsconfig.json' index.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint . && tsc --noEmit",
    "lint:fix": "eslint . --fix"
  },
  "dependencies": {
    "adm-zip": "^0.5.17",
    "better-sqlite3": "^12.9.0",
    "express": "^4.18.2",
    "express-session": "^1.17.3",
    "fast-xml-parser": "^5.7.1",
    "mime-types": "^2.1.35",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.34.5"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.8",
    "@types/better-sqlite3": "^7.6.8",
    "@types/express": "^4.17.21",
    "@types/express-session": "^1.17.10",
    "@types/jest": "^29.5.12",
    "@types/mime-types": "^2.1.4",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.11.20",
    "@types/supertest": "^6.0.2",
    "eslint": "^10.2.1",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-prettier": "^5.5.5",
    "jest": "^29.7.0",
    "nodemon": "^3.1.14",
    "prettier": "^3.8.3",
    "supertest": "^6.3.4",
    "ts-jest": "^29.1.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3",
    "typescript-eslint": "^8.58.2"
  }
}
```

Note: `@eslint/js`, `eslint-import-resolver-typescript`, `eslint-plugin-import-x`, and `eslint-plugin-react-hooks` are intentionally omitted — they are only used by the client eslint config and will be added to `client/package.json` in Task 3.

- [ ] **Step 6: Rewrite root `package.json` as workspace root**

Replace the full file content with:
```json
{
  "name": "hass-odps",
  "version": "1.1.1",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "build": "npm run build -w server && npm run build -w client",
    "start": "node server/dist/index.js",
    "dev": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "test": "npm test -w server",
    "test:watch": "npm run test:watch -w server",
    "lint": "npm run lint -w server && npm run lint -w client",
    "lint:fix": "npm run lint:fix -w server && npm run lint:fix -w client"
  }
}
```

No `dependencies` or `devDependencies` — all deps live in workspace `package.json` files.

- [ ] **Step 7: Delete `client/package-lock.json`**

```bash
rm client/package-lock.json
git rm client/package-lock.json
```

npm workspaces produces a single root lockfile covering all workspaces. The client's separate lockfile is replaced.

- [ ] **Step 8: Regenerate the root lockfile**

```bash
npm install
```

This installs all workspace deps, hoists shared packages to root `node_modules`, and writes a new `package-lock.json` at the repo root covering both workspaces.

Expected: `package-lock.json` is updated, no errors.

- [ ] **Step 9: Verify tests pass under the new workspace structure**

```bash
npm test
```

This now runs `npm test -w server`, which runs `jest` from `server/` using `server/jest.config.js`.

Expected: all tests pass.

- [ ] **Step 10: Update `run.sh`**

Replace the full file content with:
```sh
#!/usr/bin/env sh
set -e
exec node /app/server/dist/index.js
```

The compiled output now lands in `server/dist/` (because `server/tsconfig.json` has `outDir: "./dist"` relative to `server/`), so the absolute container path is `/app/server/dist/index.js`.

- [ ] **Step 11: Commit**

```bash
git add server/tsconfig.json server/jest.config.js server/package.json package.json package-lock.json run.sh
git commit -m "refactor: move config files into server/ workspace and convert to npm workspaces"
```

---

## Task 3: Split eslint config into workspaces

The current root `eslint.config.mjs` covers both server and client in separate sections. This task creates workspace-specific configs and deletes the root one.

**Files:**
- Modify: `client/package.json` (add eslint devDeps + lint scripts)
- Create: `server/eslint.config.mjs`
- Create: `client/eslint.config.mjs`
- Delete: `eslint.config.mjs`

- [ ] **Step 1: Add eslint devDeps to `client/package.json`**

Add the following entries to the `devDependencies` section of `client/package.json`:
```json
"@eslint/js": "^10.0.1",
"eslint": "^10.2.1",
"eslint-config-prettier": "^10.1.8",
"eslint-import-resolver-typescript": "^4.4.4",
"eslint-plugin-import-x": "^4.16.2",
"eslint-plugin-prettier": "^5.5.5",
"eslint-plugin-react-hooks": "^7.1.1",
"prettier": "^3.8.3",
"typescript-eslint": "^8.58.2"
```

The `lint` and `lint:fix` scripts are already present in `client/package.json` — no change needed there.

- [ ] **Step 2: Update the lockfile with the new client deps**

```bash
npm install
```

Expected: `package-lock.json` is updated with the new client eslint deps, no errors.

- [ ] **Step 3: Create `server/eslint.config.mjs`**

Create `server/eslint.config.mjs` with this content (extracted from the server section of the current root config, with the file glob updated for workspace-local paths):
```js
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      ...eslintConfigPrettier.rules,
      "prettier/prettier": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
);
```

Changes from root config:
- `files: ["**/*.ts"]` (was `"server/**/*.ts"` — now relative to workspace root)
- `ignores` covers `dist/` and `node_modules/` locally

- [ ] **Step 4: Create `client/eslint.config.mjs`**

Create `client/eslint.config.mjs` with this content (extracted from the client section of the current root config, with path adjustments for workspace-local execution):
```js
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import eslintPluginPrettier from "eslint-plugin-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      import: importX,
      prettier: eslintPluginPrettier,
      "react-hooks": reactHooks,
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
        node: true,
      },
    },
    rules: {
      ...eslintConfigPrettier.rules,
      "prettier/prettier": "error",
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index"
          ],
          pathGroups: [
            { pattern: "@/**", group: "internal" },
            { pattern: "src/**", group: "internal" },
            { pattern: "~/**", group: "internal" },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/newline-after-import": "error",
      ...reactHooks.configs.recommended.rules,
    },
  },
);
```

Changes from root config:
- `files: ["src/**/*.{ts,tsx}"]` (was `"client/src/**/*.{ts,tsx}"`)
- `settings["import-x/resolver"].typescript.project`: `"./tsconfig.json"` (was `"./client/tsconfig.json"`)
- `ignores` covers local `dist/` and `node_modules/`

- [ ] **Step 5: Delete root `eslint.config.mjs`**

```bash
git rm eslint.config.mjs
```

- [ ] **Step 6: Verify lint passes for both workspaces**

```bash
npm run lint
```

This runs `npm run lint -w server && npm run lint -w client`. Each workspace finds its own `eslint.config.mjs`.

Expected: both workspaces lint exits 0.

- [ ] **Step 7: Commit**

```bash
git add server/eslint.config.mjs client/eslint.config.mjs client/package.json package-lock.json
git commit -m "refactor: split eslint config into server and client workspaces"
```

---

## Task 4: Update Dockerfiles for workspace package structure

The Dockerfiles currently copy `package*.json` and `tsconfig.json` from root only, then run separate `npm ci --prefix client`. With workspaces, all three `package*.json` sets must be present before a single `npm ci` at root.

Note: The spec listed `Dockerfile.dev` as unchanged, but it currently copies `tsconfig.json` (now gone from root) and uses `npm ci` without workspace package files — it must be updated.

**Files:**
- Modify: `Dockerfile`
- Modify: `Dockerfile.dev`

- [ ] **Step 1: Replace `Dockerfile` with the workspace-aware version**

```dockerfile
# Build stage
FROM node:24-alpine AS builder
WORKDIR /app

# Install all workspace deps
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci

# Backend source
COPY server/ ./server/

# Client source
COPY client/index.html client/vite.config.ts client/tsconfig.json ./client/
COPY client/src/ ./client/src/

# Build everything
RUN npm run build

# Production stage
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3000
CMD ["/run.sh"]
```

Key changes:
- Install step: copies all three `package*.json` sets, then single `npm ci` (replaces two separate installs)
- `tsconfig.json` no longer copied (moved to `server/`, included in `COPY server/`)
- Build stage: `COPY server/ ./server/` (was `COPY app/ ./app/`)
- Production dist: `./server/dist` (was `./dist`)

- [ ] **Step 2: Replace `Dockerfile.dev` with the workspace-aware version**

```dockerfile
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci

EXPOSE 3000
CMD ["npm", "run", "dev"]
```

Key changes:
- Copies all three `package*.json` sets before `npm ci`
- Removes `tsconfig.json` from the COPY line (it now lives in `server/`, which is volume-mounted at runtime)

- [ ] **Step 3: Commit**

```bash
git add Dockerfile Dockerfile.dev
git commit -m "refactor: update Dockerfiles for npm workspaces structure"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run lint across all workspaces**

```bash
npm run lint
```

Expected: both server and client lint pass, exits 0.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all server tests pass.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: `server/dist/` is populated with compiled JS; `client/dist/` is populated with the bundled frontend. No errors.
