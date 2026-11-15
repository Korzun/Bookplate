# MCP Upload Links and Self-Fulfilled Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a shell-capable MCP client upload EPUBs up to 50 MB via a one-time PUT link on Bookplate's own origin, and let a reader close their own book request (with the admin notified).

**Architecture:** An in-memory upload-slot registry (modelled on `services/replace-staging.ts`) backs a new `create_upload_link` tool and an unauthenticated, token-addressed `PUT /mcp/uploads/:token` route that streams into the staging dir. `bytes-input.ts` gains `uploadId` as a third input form, so `upload_book` and `stage_replacement` consume the staged file unchanged. `bookRequestFulfill` becomes owner-or-admin; `fulfillBookRequest` learns who acted and enqueues either `book_request.fulfilled` (admin acted) or the new admin-audience `book_request.closed_by_requester` (owner acted).

**Tech Stack:** TypeScript, Express 5, `@modelcontextprotocol/sdk`, zod, Pothos GraphQL, Prisma/SQLite, vitest, React client (labels only).

**Spec:** `docs/superpowers/specs/2026-11-15-mcp-upload-links-design.md`

All paths below are relative to `app/server/` unless they start with `app/client/`, `README.md` or `CHANGELOG.md`.

## Global Constraints

- Upload cap: **50 MB** (`MAX_LINK_UPLOAD_BYTES = 50 * 1024 * 1024`). Inline (`MAX_INLINE_BYTES`) and `url` (`DEFAULT_MAX_BYTES` 200 MB) paths are unchanged.
- Upload link lifetime: **15 minutes** from creation (`UPLOAD_SLOT_TTL_MS = 15 * 60 * 1000`); a filled slot stays claimable until the same expiry.
- Link token: `crypto.randomBytes(32).toString('base64url')`. Never logged; never accepted by a tool. Tools take `uploadId` (`randomUUID()`), a different value.
- The global `requestTimeout(90_000)` in `server.ts` stays in force for the upload route. Do not reorder `server.ts` middleware except for the log redaction in Task 2.
- Unknown / expired / already-filled token → **404** `{ error: 'Upload link not found' }` — never distinguish.
- Readers may fulfil only their own pending requests with a book in their own library. Admin behaviour unchanged.
- Event name `book_request.closed_by_requester`, GraphQL member `BOOK_REQUEST_CLOSED_BY_REQUESTER`, audience `admin`, settings label `Request closed by reader`.
- Copy, exact: mail subject and push title `${requesterUsername} closed their request for ${title}`; body line `They added it to their library themselves — nothing left for you to do.`
- Never roll back an import because closing a request failed.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before finishing: `cd app/server && npm test` and, from repo root, `npm run lint` (both workspaces).

## Review Focus

1. **Client disconnects mid-PUT, or the 90 s timeout fires** — the partial file is removed and the slot is burned (404 on retry; agent makes a new link). Test in Task 2.
2. **Agent calls `upload_book` before `curl` finished** (slot open, no file) — clear `ToolError` "The file hasn't arrived yet — run the curl command first", slot left usable. Test in Task 4.
3. **Same `uploadId` used twice** (e.g. `upload_book` retried after a validation failure) — second call says "not found or expired", because the first call consumed the file. Test in Task 4.
4. **`upload_book` with a `requestId` for a book that's a duplicate** — no import, error names the existing book id so the agent can call `fulfill_book_request`; the request is untouched. Test in Task 6.
5. **A token in the URL reaching logs** — `requestLog` prints `/mcp/uploads/[redacted]`. Test in Task 2.

---

### Task 1: Upload-slot registry, wired through deps

**Files:**
- Create: `services/upload-slots.ts`
- Test: `services/upload-slots.test.ts`
- Modify: `index.ts` (create one instance next to `createReplaceStaging`, pass to `createMcpRouter`), `mcp/index.ts` (`McpRouterDeps.uploadSlots`), `mcp/handler.ts` (pass into `ToolDeps`), `mcp/tools/deps.ts` (`uploadSlots: UploadSlots`), `mcp/test-support.ts` (harness builds one with a temp staging dir)

**Interfaces:**
- Produces:
  ```ts
  export const MAX_LINK_UPLOAD_BYTES: number;          // 50 MB
  export const UPLOAD_SLOT_TTL_MS: number;             // 15 min
  export type UploadSlotLink = { uploadId: string; token: string; expiresAt: number };
  export type ClaimedUpload = { path: string; size: number; filename: string | null };
  export type ClaimOutcome =
    | { kind: 'claimed'; file: ClaimedUpload }
    | { kind: 'missing' }      // unknown id, other user's id, expired, or already claimed
    | { kind: 'pending' };     // slot open, file not arrived yet
  export type UploadSlots = {
    create(userId: string, filename?: string | null): UploadSlotLink;
    /** Atomically moves an open slot to 'receiving'; null if token unknown/expired/not open. */
    beginReceive(token: string): { uploadId: string; destPath: string } | null;
    /** 'receiving' → 'filled'. */
    completeReceive(uploadId: string, size: number): void;
    /** 'receiving' → burned; deletes destPath if present. */
    failReceive(uploadId: string): void;
    /** 'filled' and owned by userId → removed from registry, file ownership passes to caller. */
    claim(uploadId: string, userId: string): ClaimOutcome;
    /** Removes expired slots and their files. Called lazily from every method. */
    sweep(): void;
  };
  export function createUploadSlots(deps: { stagingDir: string; ttlMs?: number; now?: () => number }): UploadSlots;
  ```
- `destPath` is `<stagingDir>/mcp-link-<uploadId>.epub`.

- [ ] **Step 1: Write failing tests** in `services/upload-slots.test.ts` (inject `now`, temp dir):
  - `create returns distinct uploadId and a 43-char base64url token` — `token` matches `/^[A-Za-z0-9_-]{43}$/`, `token !== uploadId`, `expiresAt === now + 15*60*1000`.
  - `beginReceive works once per token` — second call returns `null`.
  - `claim before completeReceive is pending` — `{ kind: 'pending' }`, and a later claim after `completeReceive` succeeds.
  - `claim by another user is missing`, and the owner can still claim afterwards.
  - `claim is single-use` — second claim `{ kind: 'missing' }`.
  - `expired slots are missing and their files deleted` — advance `now` past TTL; `beginReceive` → null; for a filled slot, `claim` → missing and `fs.existsSync(destPath) === false`.
  - `failReceive deletes the partial file and burns the token`.
- [ ] **Step 2: Run** `npx vitest run services/upload-slots.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `createUploadSlots`** — a `Map<uploadId, Entry>` plus `Map<token, uploadId>`; states `open | receiving | filled`. Then wire the instance through `index.ts` → `McpRouterDeps` → `handler.ts` → `ToolDeps`, and add it to the test harness.
- [ ] **Step 4: Run** `npx vitest run services/upload-slots.test.ts mcp/` — Expected: PASS (existing MCP tests still green).
- [ ] **Step 5: Commit** `feat(mcp): add in-memory upload-slot registry`.

### Task 2: `PUT /mcp/uploads/:token` route and log redaction

**Files:**
- Create: `mcp/upload-route.ts`
- Test: `mcp/upload-route.test.ts`
- Modify: `mcp/index.ts` (mount before `POST /mcp`; rate-limit with the app's own `createIpRateLimit` from `routes/ui.ts` — `{ maxAttempts: 30, windowMs: 15 * 60 * 1000, label: 'mcp-upload', trustProxyHops: config.trustProxyHops ?? 0 }` — not `express-rate-limit`, which is only a transitive dependency), `middleware/request-log.ts` (redact)

**Interfaces:**
- Consumes: `UploadSlots.beginReceive / completeReceive / failReceive`, `MAX_LINK_UPLOAD_BYTES` (Task 1).
- Produces: `export function uploadRoute(deps: { uploadSlots: UploadSlots; maxBytes?: number }): Router` handling `PUT /mcp/uploads/:token` and answering any other method on that path with 405 `Allow: PUT`.
- Also: `export const redactUploadToken = (url: string): string` in `middleware/request-log.ts`, replacing `/mcp/uploads/<anything up to ? or end>` with `/mcp/uploads/[redacted]`.

- [ ] **Step 1: Write failing tests** with supertest against an app that mounts only `uploadRoute` (temp staging dir):
  - `stores a zip body and answers 201 with uploadId and size` — body starts with `PK\x03\x04`; response `{ uploadId, size }`; slot is `filled` (claim succeeds with that size).
  - `rejects a second PUT to the same link with 404`.
  - `rejects an unknown token with 404 and the generic message` — body `{ error: 'Upload link not found' }`.
  - `rejects Content-Length over the cap with 413 before reading` (use `maxBytes: 1024`).
  - `aborts a chunked body that grows past the cap with 413 and removes the file` (no Content-Length, `maxBytes: 1024`).
  - `rejects a non-zip body with 415, removes the file, burns the link`.
  - `removes the partial file when the client aborts mid-upload` (destroy the request socket after one chunk; then the staging dir has no `mcp-link-*` file and `claim` → missing).
  - `GET on the upload path is 405 with Allow: PUT`.
  - In `middleware/request-log` test (create `middleware/request-log.test.ts` if absent): `redactUploadToken('/mcp/uploads/abc?x=1')` → `'/mcp/uploads/[redacted]?x=1'`; other paths unchanged.
- [ ] **Step 2: Run** `npx vitest run mcp/upload-route.test.ts middleware/request-log.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Stream `req` → `fs.createWriteStream(destPath)` counting bytes; on overflow destroy and `failReceive`; on `req` `'aborted'`/`'error'` or `res` `'close'` before finish, `failReceive`. After finish, read the first 4 bytes; not `50 4B 03 04` → 415 + `failReceive`. Wrap every listener body; nothing may throw from a stream listener (same discipline as `fetch-epub.ts`). Use `redactUploadToken(req.originalUrl)` in `requestLog`'s line.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `npx vitest run mcp/index.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): accept EPUB uploads through one-time PUT links`.

### Task 3: `create_upload_link` tool

**Files:**
- Create: `mcp/tools/create-upload-link.ts`
- Modify: `mcp/server.ts` (`registerCreateUploadLink` in `registerWriteTools`, before `registerUploadBook`)
- Test: `mcp/server.test.ts` (`describe('write tools')`), and the tools/list assertion if it enumerates write tools.

**Interfaces:**
- Consumes: `deps.uploadSlots.create`, `deps.baseUrl`, `MAX_LINK_UPLOAD_BYTES`.
- Produces: tool `create_upload_link`, input `{ filename?: string (max 255) }`, output
  `{ uploadId: string; uploadUrl: string; expiresAt: string /* ISO */; maxBytes: number; curl: string }`
  where `uploadUrl = new URL('/mcp/uploads/' + token, deps.baseUrl).href` and
  `curl = 'curl --fail -T "<path-to-file.epub>" "' + uploadUrl + '"'`.
  Annotations: `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false`. Runs under `guarded(deps, { write: true }, …)`.
- Description (exact): `'Gets a one-time link for uploading an EPUB (up to 50 MB) from a machine with a shell, so the file never has to pass through the conversation. PUT the file to uploadUrl (the curl field is a ready command), then call upload_book or stage_replacement with uploadId. The link works once and expires in 15 minutes.'`
- Text output: the curl line, then `Then call upload_book with uploadId "<id>".`

- [ ] **Step 1: Write failing tests:**
  - `create_upload_link returns a link on the public origin` — `uploadUrl` starts with `https://books.example/mcp/uploads/`, `maxBytes === 52428800`, `curl` contains `uploadUrl`, `uploadUrl` does not contain `uploadId`.
  - `create_upload_link is refused on a read-only connection` — text is `READ_ONLY_MESSAGE`.
- [ ] **Step 2: Run** `npx vitest run mcp/server.test.ts -t create_upload_link` — Expected: FAIL.
- [ ] **Step 3: Implement** `registerCreateUploadLink(server: McpServer, deps: ToolDeps): void`.
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): add create_upload_link tool`.

### Task 4: `uploadId` input for `upload_book` and `stage_replacement`

**Files:**
- Modify: `mcp/tools/bytes-input.ts`, `mcp/tools/upload-book.ts` (description), `mcp/tools/stage-replacement.ts` (description), `services/import-epub.ts` (duplicate outcome carries id)
- Test: `mcp/server.test.ts`, `services/import-epub.test.ts`

**Interfaces:**
- Consumes: `UploadSlots.claim` (Task 1).
- Produces:
  - `bytesInputShape.uploadId: z.string().max(64).optional().describe('An uploadId from create_upload_link, after the file was PUT to its link')`.
  - `resolveEpubFile(input: BytesInput, destDir: string, opts: { uploadSlots: UploadSlots; userId: string; fetchOptions?: FetchEpubOptions }): Promise<EpubFile>` — signature change; update both callers. Exactly one of `url`, `contentBase64`, `uploadId`, else `ToolError('Pass exactly one of url, contentBase64 or uploadId')`.
  - Claim outcomes → `ToolError`: `missing` → `'That upload was not found or has expired; create a new link with create_upload_link'`; `pending` → `"The file hasn't arrived yet — run the curl command first"`. `filename` falls back `input.filename` → slot filename → `'upload.epub'` (through existing `epubName`).
  - `importEpub` duplicate outcome becomes `{ kind: 'duplicate'; existingBookId: string }` (from `BookAlreadyExistsError.existingId`); `upload_book`'s duplicate error becomes `` `A book with the same fingerprint is already in the library (id ${globalId}).` `` with `globalId = encodeBookGlobalId(owner.userId, existingBookId)`.
  - Prepend to both tool descriptions: `'From a machine with a shell, prefer create_upload_link and pass uploadId. '`

- [ ] **Step 1: Write failing tests:**
  - `upload_book imports a file PUT through an upload link` — create slot via `deps.uploadSlots.create`, write fixture EPUB to `destPath` via `beginReceive`/`completeReceive`, call `upload_book({ uploadId })`, expect `Imported "`.
  - `upload_book reports a link whose file has not arrived` — open slot only → error text `"The file hasn't arrived yet — run the curl command first"`; then fill and retry succeeds.
  - `upload_book refuses another reader's uploadId` — not-found message.
  - `upload_book refuses a reused uploadId` — second call not-found message.
  - `upload_book refuses two inputs at once` — `{ uploadId, url }` → `'Pass exactly one of url, contentBase64 or uploadId'`.
  - `stage_replacement accepts an uploadId`.
  - Update the existing duplicate test (line ~769) to expect the `(id ` + global id in the message.
  - `importEpub` test: duplicate returns `existingBookId`.
- [ ] **Step 2: Run** `npx vitest run mcp/server.test.ts services/import-epub.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): accept uploadId in upload_book and stage_replacement`.

### Task 5: Owner-or-admin fulfilment and the `closed_by_requester` notification

**Files:**
- Modify: `services/book-request.ts` (`fulfillBookRequest`), `graphql/schema/book-request/mutation/fulfill.ts`, `services/notification.ts`, `graphql/schema/notification-event/model.ts`, `services/mail-template.ts`, `services/notification-channel-email.ts` (TEMPLATES map), `services/push-template.ts`, `app/client/src/component/notification-settings/index.tsx` (label map), regenerated `graphql/schema.generated.graphql` and `app/client/src/gql/graphql.ts`
- Test: `services/book-request.test.ts`, `graphql/schema/book-request/mutation/fulfill.test.ts`, `services/mail-template.test.ts`, `services/push-template.test.ts`, `app/client/src/component/notification-settings/index.test.tsx`

**Interfaces:**
- Produces:
  - `fulfillBookRequest(prisma, args: { userId; id; bookUserId; bookId; actor: 'owner' | 'admin' }): Promise<FulfillOutcome>` — `actor === 'admin'` enqueues `book_request.fulfilled` (subject) as today; `'owner'` enqueues `book_request.closed_by_requester` (same payload shape). The resolver in `fulfill.ts` is the only caller (the admin's upload queue reaches it through the GraphQL mutation), so it alone decides `actor`.
  - `NOTIFICATION_EVENTS['book_request.closed_by_requester'] = { audience: 'admin' }`.
  - `requestClosedByRequesterMessage(args: NoticeArgs): MailMessage` in `mail-template.ts`, linking with `requestsLink` like `bookRequestedMessage`.
  - Resolver: replace `authScopes: { admin: true }` with the `bookRequestDelete` pattern — after decoding, `if (!isOwnerOrAdmin(context.viewer, userId)) return null;` and `actor: context.viewer?.isAdmin ? 'admin' : 'owner'`. Update the doc comment.
  - Default enablement: match whatever `book_request.created` gets today for the admin (check how preferences default in `services/notification.ts` / `notification-fields`); the new event must be on by default.

- [ ] **Step 1: Write failing tests:**
  - `fulfill.test.ts`: replace `refuses a non-admin, even the request owner` with `lets the request owner fulfil their own request with their own book` (status FULFILLED, book linked) and add `returns null for a reader fulfilling someone else's request` and `refuses an owner's book from another library` (InvalidInputError).
  - `book-request.test.ts`: `owner fulfilment enqueues closed_by_requester for the admin and nothing for the requester`; `admin fulfilment still enqueues book_request.fulfilled`.
  - `mail-template.test.ts`: subject `alice closed their request for Shards of Earth`; body contains `They added it to their library themselves — nothing left for you to do.`
  - `push-template.test.ts`: title as above; body includes the same line.
  - Client `index.test.tsx`: admin sees `Request closed by reader`; a reader does not.
- [ ] **Step 2: Run** `npx vitest run services/book-request.test.ts graphql/schema/book-request services/mail-template.test.ts services/push-template.test.ts` and `cd ../client && npx vitest run src/component/notification-settings` — Expected: FAIL.
- [ ] **Step 3: Implement**, then `npm run graphql:schema` (server) and `npm run codegen` (client).
- [ ] **Step 4: Run** the same commands plus `npx vitest run graphql/schema/viewer/notification-fields.test.ts services/notification.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(requests): let readers close their own requests and notify the admin`.

### Task 6: `fulfill_book_request` tool and `upload_book` `requestId`

**Files:**
- Create: `mcp/tools/fulfill-book-request.ts`
- Modify: `mcp/tools/upload-book.ts`, `mcp/server.ts`
- Test: `mcp/server.test.ts`

**Interfaces:**
- Consumes: `bookRequestFulfill` mutation (Task 5); `BOOK_REQUEST_FIELDS`, `bookRequestSchema`, `toBookRequest`, `describeBookRequest` from `list-book-requests.ts`; `unwrapPayload`, `userErrorFields` from `mutation.ts`.
- Produces:
  - `export async function fulfillRequest(deps: ToolDeps, requestId: string, bookId: string): Promise<ReturnType<typeof toBookRequest>>` — runs the mutation via `executeDocument`; throws `ToolError`: null → `'No pending request with that id'`; `BookRequestNotPendingError` → `` `That request is already ${status.toLowerCase()}` ``; `InvalidInputError` → its message.
  - Tool `fulfill_book_request`, input `{ requestId: string; bookId: string }`, output `{ request: bookRequestSchema }`, write-guarded, description: `'Marks one of your pending book requests fulfilled by a book already in your library. upload_book can do this in the same step via requestId. The library admin is notified.'`
  - `upload_book` input gains `requestId?: string`; output gains `request: bookRequestSchema.nullable()` and `requestError: z.string().nullable()`. After a successful import, call `fulfillRequest(deps, requestId, book.id)`; on `ToolError` keep the import and set `requestError`; text gains `Request "<title>" marked fulfilled.` or `Imported, but the request was not closed: <message>`.

- [ ] **Step 1: Write failing tests:**
  - `fulfill_book_request closes the reader's own request` — status `FULFILLED`, `bookId` matches.
  - `fulfill_book_request reports an already-fulfilled request` — `That request is already fulfilled`.
  - `fulfill_book_request cannot touch another reader's request` — `No pending request with that id`.
  - `upload_book with requestId imports and closes the request`.
  - `upload_book with a non-pending requestId keeps the book and reports requestError` — book present in library, `request === null`, `requestError` set.
  - `upload_book duplicate with requestId leaves the request pending` — error text has the existing id; `list_book_requests` still shows `PENDING`.
- [ ] **Step 2: Run** `npx vitest run mcp/server.test.ts -t "fulfill_book_request|requestId"` — Expected: FAIL.
- [ ] **Step 3: Implement**, registering `registerFulfillBookRequest` in `registerWriteTools` after `registerRequestBook`.
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): add fulfill_book_request and requestId on upload_book`.

### Task 7: Docs and full verification

**Files:**
- Modify: `README.md` (MCP tools list and upload paragraph ~lines 236–243), `CHANGELOG.md` (unreleased section)

- [ ] **Step 1:** README: add `create_upload_link` and `fulfill_book_request` to the tool list; replace the upload sentence with: uploads take an upload link (`create_upload_link`, then PUT the file — up to 50 MB, works once, 15 minutes), a public https URL, or inline base64 (about 6 MB); and readers can close their own requests. CHANGELOG: one `Added` entry for each of upload links, `fulfill_book_request`/`requestId`, readers closing their own requests + admin notice.
- [ ] **Step 2: Run** `cd app/server && npm test` — Expected: all pass.
- [ ] **Step 3: Run** from repo root `npm run lint` — Expected: no errors (includes `graphql:schema:check` and client `codegen:check`).
- [ ] **Step 4: Commit** `docs: describe MCP upload links and self-closed requests`.
