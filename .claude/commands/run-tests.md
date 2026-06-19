---
description: How to run tests and lint for this project
---

# HASS-ODPS: Running Tests and Lint

## Tests

Run from the server workspace:

```bash
cd /Users/korzun/Code/HASS-ODPS/app/server && npm test
```

## Lint

**Always run from the repo root.** The project has two separate npm workspaces (`app/client` and `app/server`), each with its own ESLint and Prettier config. Running from inside one workspace silently skips the other.

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint
```

**Never** run `npm run lint` from `app/server` or `app/client` alone when changes span both — it will pass even if the other workspace has errors.

## Before pushing

Run both:

```bash
cd /Users/korzun/Code/HASS-ODPS/app/server && npm test
cd /Users/korzun/Code/HASS-ODPS && npm run lint
```

## Why this matters

Running lint from `app/server` when a client file was changed caused two consecutive CI failures (prettier violations in `text-area/index.tsx` and `book-store.ts`). The local lint reported clean because it only checked the server workspace.
