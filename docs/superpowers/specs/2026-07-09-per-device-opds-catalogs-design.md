# Per-device OPDS catalogs for single-link clients

**Status:** Design approved, pending implementation plan
**Date:** 2026-07-09

## Problem

Bookplate serves per-device EPUB editions over OPDS. Today each book is a single
OPDS `<entry>` carrying multiple `rel="http://opds-spec.org/acquisition"` links —
the base download plus one `/opds/books/:id/devices/:slug/download` link per device.

The OPDS spec permits multiple acquisition links per entry and leaves auto-download
behavior client-defined, so behavior varies:

- **KOReader** presents all links as a selectable menu (does not silently drop them).
- **Crosspoint** (Xteink X3/X4 firmware, the client that matters here) stores a
  **single `href` per entry**. Its parser (`lib/OpdsParser/OpdsParser.cpp`) keeps the
  first acquisition link and only replaces it when a later link "looks like" a plain
  EPUB — the href contains `.epub` or `/epub/`. Bookplate's URLs (`/download`,
  `/devices/:slug/download`) match neither, so the tiebreak never fires and **the base
  download always wins**. Device editions are silently discarded.

Confirmed against Crosspoint source and the 1.4.0 release note ("OPDS downloads prefer
EPUB over KEPUB"). An entry cannot deliver a device edition to Crosspoint as long as it
carries more than one link.

## Goal

A server-side workaround that lets a Crosspoint device download its device-specific
edition, without waiting on an upstream firmware change: give each device its own OPDS
catalog in which every entry carries exactly **one** acquisition link — that device's
edition.

## Non-goals

- **Upstream Crosspoint PR** (let `OpdsEntry` hold multiple acquisition links and present
  them KOReader-style). Tracked separately; this spec is the "in the meantime" fix.
- Per-format catalogs (KEPUB, PDF, …). Out of scope now, but the design is deliberately
  shaped so a future format axis is another scoped feed, not more links per entry.

## Design

### 1. One feed factory, mounted twice

All browse/nav handlers in `app/server/routes/opds.ts` build child hrefs from a hardcoded
`${baseUrl}/opds/...` prefix, and every acquisition feed calls `bookEntry(...)`. Rather
than duplicate the 13 handlers, refactor them into a factory that reads an optional
per-request **device context**, and mount it at two roots, both inside
`createOpdsRouter` in `app/server/routes/opds.ts` (`server.ts` is not touched):

- `router.use('/', auth, baseCatalog)` — base catalog.
- `router.use('/device/:slug', resolveDevice, deviceCatalog)` — device catalog,
  with `mergeParams: true` so `:slug` is visible to the shared handlers.

Each handler computes:

```
feedBase = deviceCtx
  ? `${baseUrl}/opds/device/${deviceCtx.slug}`
  : `${baseUrl}/opds`
```

and uses `feedBase` everywhere `/opds` is currently hardcoded (child hrefs and `selfHref`).
Because the same handlers serve both mounts, full navigation mirroring — By Title / Author
/ Series / Subject / Status — is reproduced per device for free.

### 2. Downloads are not duplicated

A device feed's single acquisition link points at the **existing**
`/opds/books/:id/devices/:slug/download` endpoint via an absolute URL. So the download and
cover routes (`/books/:id/download`, `/books/:id/devices/:slug/download`,
`/books/:id/cover`) stay only on the base mount; the device sub-router is browse-only.
Editions continue to build lazily on first download through
`editionStore.getOrCreateEdition` — rendering a feed never eagerly builds editions.

### 3. `bookEntry` becomes single-link in both modes

`bookEntry` changes from `(b, baseUrl, width, devices[])` to a single optional device
param: `(b, baseUrl, width, device?)`.

- **No device** (base feed): one acquisition link → `/opds/books/:id/download`.
- **With device** (device feed): one acquisition link →
  `/opds/books/:id/devices/:slug/download`, titled for the device.

Cover / thumbnail links point at the base `/opds/books/:id/cover` in both modes. The
`deviceStore.list()` calls are removed from the base acquisition handlers.

**Deliberate behavior change:** base `/opds/books` entries no longer carry per-device
links. A KOReader user who relied on that menu now points KOReader at the device feed
instead. This is intentional — it keeps every entry single-link and makes a future
per-format axis a new scoped feed rather than more links per entry.

### 4. Client — surface the per-device URL

Add each device's catalog URL (`${origin}/opds/device/${slug}`) to the Devices admin
screen, reusing the copy-button pattern from `app/client/src/component/connection-urls`.
This is what makes the feature usable end to end: the user copies the URL into Crosspoint's
OPDS server settings.

### 5. Error handling and edge cases

- `resolveDevice` middleware 404s on an unknown slug.
- If `deviceStore` / `editionStore` are absent, the `/opds/device/:slug` mount is not
  registered; the base catalog is unaffected.
- Device feeds still authenticate as a user via `opdsAuth`; books are filtered by owner.
  The device is orthogonal (global `DeviceStore`), so any authenticated user can browse any
  device's catalog of their own books.
- A device with no editions yet still lists books; editions build on first download.

### 6. Testing

Extend `app/server/routes/opds.test.ts`:

- Device nav feeds carry `/opds/device/:slug`-prefixed child hrefs and `selfHref`.
- Device acquisition entries carry exactly one acquisition link = the device edition.
- Base acquisition entries carry exactly one acquisition link = the base download (no
  per-device links).
- Unknown device slug → 404.
- Cover / thumbnail links still resolve to the base `/opds/books/:id/cover`.

## Affected code

- `app/server/routes/opds.ts` — factor handlers into `createFeedRouter`; add `resolveDevice`
  middleware; compute `feedBase`; mount twice (base and `/device/:slug`), both within
  `createOpdsRouter`.
- `app/server/routes/opds-templates.ts` — `bookEntry` single optional-device param.
- `app/server/server.ts` — not modified; both OPDS mounts are encapsulated inside
  `createOpdsRouter`.
- `app/server/routes/opds.test.ts` — device-feed coverage; base-feed single-link assertions.
- `app/client/src/page/device-list` (and/or device row/detail) — surface per-device OPDS URL
  with copy button.
