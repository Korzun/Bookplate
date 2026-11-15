# MCP upload links and self-fulfilled requests — design

**Started:** 2026-11-15 · **Path:** brainstorming skill (project)

## Intent

An assistant that holds EPUBs on the machine it runs on (Claude Code, or any
agent with a shell) should be able to add them to Bookplate through the MCP
server and close the book request they answer, without the reader touching
the web UI.

Today that journey breaks twice. An agent trying to upload three Adrian
Tchaikovsky novels (0.6–2.5 MB each) found that `upload_book` only takes
inline base64, which means writing the whole book out as model output, or a
public https URL, which it could only produce by installing a tunnel
(Cloudflare Tunnel, ngrok) and exposing the machine. And once the book was in,
there was no MCP tool to mark the reader's "Shards of Earth" request
fulfilled; fulfilment is admin-only.

Bookplate is already reachable over https from wherever the agent is (MCP only
turns on when `public_url` is https, `mcp/base-url.ts`), so no tunnel is ever
needed: the server can host a short-lived upload slot on its own origin and
the agent pushes the file there with `curl`.

## Goals

- An agent with a shell uploads an EPUB of any size up to the existing 200 MB
  cap by: calling a tool to get a one-time upload link, `curl -T`-ing the file
  to it, then calling `upload_book` with the returned upload id.
- The same upload id works for `stage_replacement`.
- A reader can fulfil their **own pending** request with a book in their **own**
  library — from MCP via a new tool, and in one step via an optional
  `requestId` on `upload_book`.
- The book bytes never pass through the model.

## Non-goals

- Agents without a shell (claude.ai chat with an attached file, sandboxed code
  execution with no egress). Explicitly deferred; revisit separately.
- Web UI for a reader to self-fulfil. The server permission changes, but no
  reader-facing button is added in this work.
- Non-EPUB formats, batch upload in one call.
- Changing the inline-base64 or `url` input paths. They stay as they are.

## Anti-goals

- A link that works for anyone who did not get it from an authenticated MCP
  session, works twice, or outlives its short TTL.
- A link that lets one reader put a file where another reader's import can see
  it.
- Unauthenticated callers able to make the server buffer or write unbounded
  bytes (disk-fill), or hold connections open indefinitely.
- Weakening the SSRF guard in `fetch-epub.ts` (e.g. allowing LAN URLs).
- A reader fulfilling another reader's request, or fulfilling with a book from
  someone else's library.

## Constraints (from the codebase)

- MCP lives in `app/server/mcp/`. `index.ts` builds one router mounted at the
  root ahead of the global 100 kb body parser; `POST /mcp` is bearer-auth'd and
  stateless. The upload route must not sit behind a JSON parser and must stream.
- The agent's shell has no OAuth bearer token, so the link itself is the
  credential (capability URL).
- MCP viewers are always readers: `viewer.ts` hard-codes `isAdmin: false`.
- `bytes-input.ts` (`bytesInputShape`, `resolveEpubFile`) is the single place
  both `upload_book` and `stage_replacement` turn input into a file in the
  staging dir (`getStagingDir(booksDir)` → `<booksDir>/.staging`). Files are
  never held as Buffers across an import.
- `fetch-epub.ts` already has the streaming, byte-cap, wall-clock-timeout and
  partial-file-cleanup discipline (`DEFAULT_MAX_BYTES` = 200 MB). Reuse its
  approach, and ideally its EPUB sniff, for the PUT body.
- `services/replace-staging.ts` is the precedent for an in-memory, per-user,
  TTL'd registry keyed by `randomUUID()` with `resolve`/`consume`.
- Write tools go through `guarded(deps, { write: true }, …)` (`tools/execute.ts`),
  which enforces the write scope.
- `bookRequestFulfill` (`graphql/schema/book-request/mutation/fulfill.ts`) is
  `authScopes: { admin: true }`; the business logic is
  `fulfillBookRequest` in `services/book-request.ts`, which already refuses a
  book from a different library (`noSuchBook`) and a non-pending request.
  `node-scope.ts` exports `isOwnerOrAdmin`, which `bookRequestDelete` uses.
- `book_request.fulfilled` notifications go to the request's subject (the
  requester) — `services/notification.ts`.
- A parallel change today (`2026-11-15-book-request-edit-design.md`) adds a
  reader-side edit for pending requests; same owner-or-admin pattern. No
  conflict, but expect to touch neighbouring files.

## Approaches

**A. Upload-link tool, then existing tools take an `uploadId`** — *chosen.*
`create_upload_link` returns a one-time PUT URL on Bookplate's own origin; the
agent `curl -T`s the file into staging; `upload_book` / `stage_replacement`
accept `uploadId` as a third input form. All import results, validation errors
and metadata proposals keep coming back through MCP's structured output. Costs
an extra step (three calls instead of one).

**B. The PUT itself runs the import** — rejected. Fewer steps, but creates a
second, non-MCP reporting channel for import outcomes that would drift from
`upload_book`, and doesn't fit `stage_replacement`'s stage-then-commit flow.

**Ruled out:** larger/chunked base64 (the bytes still go through the model);
a local-path argument (the server can't read the agent's machine); letting
`url` reach LAN hosts (reopens SSRF and the agent still has to serve the file).

For request fulfilment the reader picked **readers can close their own
requests** over "reader withdraws instead" (inaccurate record) and
"admin-capable MCP sessions" (large auth change, doesn't help readers).

## Design

### 1. `create_upload_link` tool

- Write tool (`guarded(..., { write: true })`), no required input. Optional
  `filename` may be accepted and carried to the import, but `upload_book`'s
  `filename` also works; builder's call.
- Creates an entry in a new in-memory **upload-slot registry**: `{ id, userId,
  tokenHash or token, createdAt, expiresAt, state: 'open' | 'filled' | 'used',
  path?, size? }`.
- Returns `{ uploadId, uploadUrl, expiresAt, maxBytes, curl }`, where
  `uploadUrl = <public_url origin>/mcp/uploads/<token>` and `curl` is a
  ready-to-run example: `curl --fail -T "<file>" "<uploadUrl>"`. The text
  output tells the agent the next step (call `upload_book` with `uploadId`).
- Token: ≥128 bits from `crypto.randomBytes`, URL-safe. `uploadId` is a
  separate id the tools take, so the secret token never needs to be echoed
  back into a tool call. Compare tokens in constant time or look up by hash.
- TTL: **15 minutes** to start the upload (my call). Entries and their files
  are swept on expiry, like `replace-staging`.

### 2. `PUT /mcp/uploads/:token` route

- Mounted in `mcp/index.ts`'s router, no body parser, no bearer auth (the token
  is the credential). Only `PUT`; anything else → 405.
- Unknown, expired or already-filled token → **404** with no detail (don't
  distinguish).
- Streams the body to a fresh file in the staging dir with the same safeguards
  as `fetch-epub.ts`: 200 MB cap enforced as chunks arrive (and early-reject on
  a `Content-Length` over the cap → 413), wall-clock timeout, partial file
  removed on any failure, nothing thrown from stream listeners.
- On success, verifies the file looks like an EPUB (same sniff `fetch-epub`
  uses) — failure → 415, file removed, slot burned.
- Marks the slot `filled`; any second PUT → 404. Responds **201** with small
  JSON `{ uploadId, size }` so the agent's `curl` output confirms it.
- Rate-limited with the same proxy-aware key `index.ts` already builds for the
  OAuth limiters.

### 3. `uploadId` input on `upload_book` and `stage_replacement`

- Extend `bytesInputShape` with `uploadId`; "exactly one of `url`,
  `contentBase64`, `uploadId`".
- `resolveEpubFile` gets the slot from the registry **for the calling viewer's
  userId only**; missing / other user / expired / not yet filled → `ToolError`
  with a clear message ("upload not found or expired"; "the file hasn't
  arrived yet — run the curl command first"). Consuming it marks it `used` and
  hands over the staged path; the existing import flow then owns the file as it
  does for downloaded files.
- Update tool descriptions to steer shell-capable agents toward
  `create_upload_link` + `uploadId` for anything larger than a few KB, and
  update the README MCP section.

### 4. Readers fulfil their own requests

- **Server permission:** `bookRequestFulfill` moves from `admin` to
  owner-or-admin, using `isOwnerOrAdmin` on the decoded request id the way
  `bookRequestDelete` does. A non-owner non-admin gets the same `null` ("no
  such request") a miss gets. `fulfillBookRequest` already rejects a book
  outside the request owner's library and non-pending requests.
- **Notification:** when the requester fulfils their own request, **skip**
  the `book_request.fulfilled` notification (it would only tell them about
  their own action). Admin-initiated fulfilment notifies as today.
  Implemented by passing who acted into `fulfillBookRequest`.
- **New MCP tool `fulfill_book_request`**: input `{ requestId, bookId }` (ids
  as `list_book_requests` and the book tools return them); runs the mutation
  through `executeDocument`; returns the updated request (`bookRequestSchema`).
  Maps `BookRequestNotPendingError` and `InvalidInputError` to `ToolError`s
  with readable text.
- **`upload_book` gets optional `requestId`.** After a successful import, it
  fulfils that request with the new book. If the import succeeded but
  fulfilment fails (request not pending, not found), the book stays imported
  and the result says so plainly (a `request` field that is null plus a
  warning line) — never roll back an import over a request problem.
- Duplicate case: when `upload_book` refuses a duplicate, the error should
  include the existing book's id so the agent can call `fulfill_book_request`
  with it. (Today the duplicate outcome may not carry the id — builder to
  check `importEpub`'s `duplicate` outcome and add it if cheap.)

### The agent's journey, end to end

```
list_book_requests(status: PENDING)        → finds "Shards of Earth", id=R
create_upload_link()                       → uploadId=U, uploadUrl, curl example
$ curl --fail -T "Shards of Earth.epub" "<uploadUrl>"   → 201 {uploadId, size}
upload_book(uploadId: U, requestId: R)     → book, fixes, proposals, request: FULFILLED
create_upload_link() / curl / upload_book(uploadId) for the other two
resolve_metadata_fixes(...)                → as today
```

## Left to the builder

- Registry shape and whether it's a new module or a generalisation of
  `replace-staging.ts` (prefer a small new module if generalising would bend
  `replace-staging`'s existing contract).
- Exact rate-limit numbers for the PUT route; keep them generous enough for a
  handful of books in a row.
- Whether `create_upload_link` takes `filename`.
- Test layout, following `server.test.ts`, `fetch-epub.test.ts`,
  `fulfill.test.ts` and `book-request.test.ts` patterns. Cover: token
  single-use, expiry, cross-user `uploadId` refusal, cap/timeout/partial-file
  cleanup, non-EPUB body, owner-vs-non-owner fulfil, notification skipped on
  self-fulfil, import-succeeds-but-fulfil-fails.
- CHANGELOG entry.
