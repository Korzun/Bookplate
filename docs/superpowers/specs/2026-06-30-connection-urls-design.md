# Connection URLs on the settings page

## Goal

Show non-admin users the two service URLs they need to configure their reader
devices, directly on the user settings page:

- **Sync (KOSync)** — the KOSync server address for KoReader progress sync.
- **OPDS** — the OPDS catalog root for browsing the library from a reader.

Today users have no in-app way to discover these URLs; they must know the host
and the route prefixes by heart.

## URL derivation

Both services are mounted on the same origin that serves the web UI
(`server.use('/opds', …)` and `server.use('/kosync', …)` in
`app/server/server.ts`). The frontend therefore derives both URLs purely
client-side from the browser's current origin — no backend change:

```ts
const base = window.location.origin;
const syncUrl = `${base}/kosync`;
const opdsUrl = `${base}/opds`;
```

Using `window.location.origin` means the displayed URLs always reflect the exact
public host the user reached the app through (LAN address, reverse proxy, or
Cloudflare tunnel), which is what their reader device needs.

## Component

New presentational component `ConnectionUrls`, co-located at
`app/client/src/component/connection-urls/`:

- `index.tsx` — the component.
- `style.ts` — co-located JSS, reusing the `pill` / `pillIcon` / mono-value
  treatment from `app/client/src/component/sync-password/style.ts`.

Structure: a single `Card` titled **"Connection URLs"** containing two stacked
rows. Each row reuses the existing "pill" pattern from `SyncPassword`:

```
┌─ Connection URLs ──────────────────────┐
│ [icon] Sync   https://…/kosync  [Copy] │
│ [icon] OPDS   https://…/opds    [Copy] │
└────────────────────────────────────────┘
```

Each row:

- A short faint label ("Sync" / "OPDS") so the two pills are distinguishable.
- An existing icon from `~/icon` (no new icons added): `books` for OPDS; a
  sync-appropriate existing icon for Sync (e.g. `clock`, finalized during
  implementation against what reads best).
- The URL in the monospace value style.
- A `Copy` button reusing the `navigator.clipboard.writeText` + `CheckIcon`
  success toggle with a 2s reset, exactly as `SyncPassword` does. Each row owns
  an independent `copied` state so copying one does not flip the other.

No loading or error states: `window.location.origin` is synchronous and always
available in the browser, so this component is simpler than `SyncPassword`.

To keep two copy buttons from duplicating logic, the copyable pill is factored
into a small internal row (label + icon + url + copy button) rendered once per
service.

## Wiring

- Export `ConnectionUrls` from the `~/component` barrel
  (`app/client/src/component/index.ts`).
- Render `<ConnectionUrls />` in the non-admin branch of
  `app/client/src/page/user/index.tsx`, directly after `<SyncPassword />`.
- Admin view is unchanged (admins do not sync personal reading progress).

## Testing

Follow the repo's existing client test conventions (co-located `*.test.tsx`, per
`2026-05-22-client-tests-design.md` and `2026-04-18-kebab-case-and-colocated-tests-design.md`).
Add a co-located `index.test.tsx` that:

- Renders the component and asserts both URLs are built from the current origin
  with the `/kosync` and `/opds` suffixes.
- Asserts that clicking a row's Copy button writes that row's URL to the
  clipboard.

If existing settings components (e.g. `SyncPassword`) have no co-located tests,
match that convention rather than introducing a one-off; the derivation logic is
trivial string concatenation and otherwise verified manually.

## Out of scope

- No backend/API changes.
- No QR codes or "setup instructions" copy — just the copyable URLs.
- Admin-facing display.
