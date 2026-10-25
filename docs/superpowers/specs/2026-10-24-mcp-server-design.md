# MCP server with OAuth — design

Date: 2026-10-24
Status: design, written autonomously from the request; every "Decision" below is
the author's call unless marked as the requester's.

## Intent

Let an AI assistant (Claude.ai, Claude Desktop, Claude Code, or any other MCP
client) act on a reader's Bookplate library on that reader's behalf: find books
and series, read their metadata, fix metadata, run validation, upload new books,
replace a book's EPUB, and act on the metadata recommendations the import
pipeline produces. The reader authorizes each assistant once, through the web
UI, and can see and revoke every connected assistant from Settings.

The request (requester's words): "an OAuth MCP server. The actions should
enable searching, viewing books and series (and the associated metadata),
editing a book's metadata, running validation, upload and replace, uploading a
book, taking actions on metadata recommendations, and anything else you think
we should enable. There should be a section in settings that allows the user to
see all the connected MCP clients and disconnect them."

## Goals

- A standards-compliant remote MCP server over Streamable HTTP that Claude.ai's
  custom-connector flow (and the MCP TypeScript client) can connect to with no
  manual token copying: OAuth 2.1 authorization code + PKCE, dynamic client
  registration, protected-resource and authorization-server metadata.
- Tools cover every action the request names, plus the obvious neighbours
  (reading progress, book requests, cover images, delete), each scoped to the
  signed-in reader's own library exactly as the web UI is.
- A Settings card listing connected assistants with a Disconnect button that
  invalidates that assistant's tokens immediately.
- No second business-logic path. Every tool resolves to the same GraphQL
  operations the SPA uses (executed in-process), or to the same service
  function REST already calls for the two binary seams (upload, replace).

## Non-goals

- Admin-account access over MCP. The config admin owns no library; the
  consent screen refuses it with a clear message. A reader account is the
  unit of connection.
- A general OAuth identity provider. The authorization server exists only to
  mint tokens for this MCP server; no other resource consumes them.
- MCP resources, prompts, sampling, elicitation, or server-initiated
  notifications. Tools only, stateless transport.
- A client-side MCP client or any "chat with your library" UI in Bookplate.
- Scope-level consent granularity beyond read vs. write.

## Anti-goals (would make this a failure even if it worked)

- Tokens that outlive a disconnect. Disconnect deletes the grant; every access
  and refresh token hanging off it dies with it. Opaque, hashed, DB-backed
  tokens — not JWTs — for exactly this reason.
- An MCP viewer that can reach another reader's rows. Tool execution goes
  through the existing Pothos scope-auth (`authenticated`, `ownerOf`,
  `ownerScopedFindUnique`) with a `Viewer` built from the grant, so the
  tenancy rules are the schema's, not a second copy.
- A `Host`-derived issuer. `types.ts` already records why a header-derived
  absolute URL is a poisoning path for emails; OAuth metadata is the same
  class of thing. MCP is enabled only when `public_url` is configured.
- An upload-by-URL tool that doubles as an SSRF primitive. The private-host
  rule the push-endpoint check already enforces applies to fetched URLs.

## Constraints (from the codebase)

- Server is CommonJS TypeScript on Express 5; `@modelcontextprotocol/sdk`
  1.32.x ships CJS and depends on Express 5 and zod `^3.25 || ^4`, matching
  the installed zod 4. Its subpath exports (`server/mcp.js`,
  `server/streamableHttp.js`, `server/auth/*`) are used directly.
- Schema DDL for tables with a foreign key to `users` must be created in
  `db/migrate.ts`'s data-migration pass, not in a Prisma SQL migration, because
  `data_v10_user_surrogate_id` rebuilds `users` and drops anything the DDL pass
  attached to it. The matching `prisma/migrations/<ts>_add_mcp/migration.sql`
  is an intentionally-empty file, as for push subscriptions.
- The SDK's `mcpAuthRouter` hard-codes `/authorize`, `/token`, `/register`,
  `/revoke` at the site root. Bookplate keeps its root for the SPA, so the
  individual handlers (`authorizationHandler`, `tokenHandler`,
  `clientRegistrationHandler`, `revocationHandler`, `mcpAuthMetadataRouter`)
  are mounted under `/mcp/oauth/*` with a hand-built `OAuthMetadata` object
  naming those paths. The well-known documents stay at the root, as RFC 8414 /
  RFC 9728 require.
- The SDK's `authenticateClient` compares `client.client_secret` to the posted
  secret in plaintext, so a registered client's secret is stored as issued.
  PKCE is the real protection; the secret is a low-value credential and the
  SQLite file is local. Recorded here so nobody "fixes" it into a hash and
  breaks the token endpoint.
- The SDK requires an https issuer unless the host is `localhost`/`127.0.0.1`
  or `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` is set. A LAN-only `http://`
  `public_url` therefore cannot host the OAuth server; the boot log says so and
  MCP stays off.
- Every GraphQL root field requires `authenticated`, which also refuses a
  viewer with a pending forced password change or a missing required email.
  An MCP viewer in either state gets one clear error from every tool.
- `apollo-client` codegen generates from the committed SDL; the new
  `Viewer.mcpConnections` field and mutations need `graphql:schema` regenerated
  and client `codegen` rerun, both checked in CI.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Transport | Streamable HTTP, stateless (`sessionIdGenerator: undefined`, JSON responses), one `McpServer` built per request | No session table, nothing to leak across restarts, survives Cloudflare's 100 s proxy timeout because no request is long-lived. GET (server→client SSE) and DELETE return 405 as the SDK does in this mode. |
| Endpoint | `POST /mcp` | One path; the protected-resource metadata lives at `/.well-known/oauth-protected-resource/mcp`. |
| Authorization server | Bookplate itself, via the SDK's handlers against a Prisma-backed `OAuthServerProvider` | No external IdP to configure for a Home Assistant add-on. |
| OAuth endpoints | `/mcp/oauth/authorize`, `/mcp/oauth/token`, `/mcp/oauth/register`, `/mcp/oauth/revoke`; metadata at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp` | Keeps the SPA's root namespace; see Constraints. |
| Issuer / resource URL | `config.publicUrl` (issuer) and `${publicUrl}/mcp` (resource). MCP is not mounted when `public_url` is unset or not https/localhost; one `warn` line at boot explains. | Anti-goal: no Host-derived issuer. |
| Client registration | Dynamic (RFC 7591) with no pre-shared credentials; secrets never expire (`clientSecretExpirySeconds: 0`) | Claude.ai registers itself. An expiring secret would silently break a connector after 30 days with no UI to re-register. |
| Consent | SPA route `/connect` (protected). `provider.authorize` 302s to it carrying the validated params. Approve/deny posts a GraphQL mutation `mcpAuthorize`, which re-validates client and redirect URI, writes the code, and returns the redirect URL the browser follows. | Reuses the SPA's login, token refresh, theming and gates. Deny goes through the server too so an unregistered `redirect_uri` can never be followed (open-redirect). |
| Scopes | `library:read`, `library:write`. A request naming no scope asks for both. The consent page carries a "Read only" switch (off by default); approving with it on grants `library:read` alone regardless of what the client asked. Write tools refuse a token without `library:write`. | Claude.ai never lets the user choose scopes, so without the switch read-only would be unreachable from the primary client. The granted set is what the grant stores and what the token carries; a client that then asks for `library:write` on refresh is refused (scopes cannot widen). |
| Tokens | Opaque 32-byte base64url; SHA-256 hash stored. Access 1 h, refresh 30 d, refresh rotated on use (old one deleted in the same statement). Codes 10 min, single use, bound to client, redirect URI, PKCE challenge, scopes, resource, user. | Revocable, same hashing convention as `refresh_tokens`. |
| Grant model | One `mcp_grants` row per (user, client). Re-authorizing the same client upserts the row and deletes its previous tokens. | The Settings list shows one row per assistant, and "re-connect" means the old tokens were lost. |
| Disconnect | `viewerRevokeMcpConnection(id)` deletes the grant; codes and tokens cascade. The SDK `revoke` endpoint deletes the single presented token. | Immediate, no token-blacklist sweep. |
| Tool execution | In-process `graphql()` against the real schema with a `Context` whose `Viewer` is `{ userId, username, isAdmin: false, mustChangePassword, mustSetEmail }` read from the DB per request | The schema's auth scopes and the owner-scoped node loaders are the tenancy boundary. No parallel service layer. |
| Binary seams | `upload_book` and `stage_replacement` accept either `url` or `contentBase64`. Bytes land in the existing replace-staging registry; the upload tool then calls the import function REST's `/api/books/upload` is refactored to share. | The GraphQL mutations cannot carry bytes (`/graphql` has a 100 kb body cap, and the SPA uses REST multipart for the same reason); MCP tools can carry a small base64 payload, and a URL covers large files. |
| `/mcp` body limit | The MCP router is mounted AHEAD of `server.ts`'s global `express.json()` and runs its own `express.json({ limit: '8mb' })`, so a `contentBase64` payload of up to roughly 6 MB of EPUB is accepted; the later global parser skips a body that is already parsed. | The global 100 kb limit would make `contentBase64` useless; 8 MB covers nearly every text-only EPUB and is held in memory only for the one request. Anything larger goes by URL. |
| URL fetch guard | https only. Resolve-then-pin: a custom `lookup` passed to `https.request` resolves the hostname once, refuses any address that `isPrivateHost` rejects (the rule currently inlined in `viewer/mutation/add-push-subscription.ts`, moved to `utils/private-host.ts` and extended to accept resolved IP literals), and connects to that address. Redirects are followed manually, at most 5 hops, each hop re-checked the same way. 200 MB cap enforced while streaming to the staging directory; 30 s total budget; response must be `application/epub+zip` or the URL path must end in `.epub`. | Anti-goal: no SSRF. A hostname denylist alone is defeated by an attacker-controlled DNS name resolving into the Supervisor network, which is exactly where this add-on runs, and any reader account can call the tool. |
| Settings UI | New `McpConnections` card on `/settings`, reader branch only: lists name, client URL, connected date, last used, scopes; a Disconnect (danger) button with a confirm modal. Above the list, the MCP URL in the same copyable pill `ConnectionUrls` uses. Hidden when the server reports MCP unavailable. | Request: "see all the connected MCP clients and disconnect them". |
| Last-used tracking | `last_used_at` on the grant, updated at most once per minute per grant | A date the reader can act on, without a write per tool call. |
| Rate limits | The SDK's per-endpoint limiters with their default windows, but keyed by `resolveLoginClientIp(req, config.trustProxyHops)` (exported from `routes/ui.ts`) and with `validate: { xForwardedForHeader: false }`; none on `/mcp` beyond the bearer check | The only deployments where MCP turns on sit behind a tunnel or reverse proxy, and `server.ts` never sets `trust proxy`, so the SDK's default `req.ip` key would put every user in one bucket and log `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`. The login limiter already solved this; reuse its resolver. |
| Client-row lifecycle | `mcp_clients` gains `last_granted_at`. The token-endpoint sweep deletes clients with `last_granted_at IS NULL` older than 24 h. A client that was ever approved is never swept, even after every grant is revoked. | `/register` is unauthenticated, so never-approved rows must be bounded; but Claude.ai stores its `client_id` and reuses it on reconnect after a disconnect, so an approved client must keep resolving. One Settings row per grant (per `client_id`); duplicate names from re-registering clients are shown as-is with their connected date to tell them apart. |

## Data model

All tables created in `db/migrate.ts` as `data_v23_mcp` (after
`data_v22_book_cover_normalized`); Prisma models mirror them.

```
mcp_clients
  client_id          TEXT PK        -- SDK-generated UUID
  client_secret      TEXT NULL      -- plaintext, see Constraints
  client_id_issued_at REAL          -- seconds since epoch (OAuth convention)
  client_secret_expires_at REAL NULL
  last_granted_at    REAL NULL     -- set on every consent approval; see Decisions
  metadata           TEXT           -- JSON: the full OAuthClientMetadata as registered
                                    --  (redirect_uris, client_name, client_uri,
                                    --   logo_uri, token_endpoint_auth_method, ...)
  created_at         REAL

mcp_grants
  id                 TEXT PK        -- nanoid
  user_id            TEXT FK users(id) ON DELETE CASCADE ON UPDATE CASCADE
  client_id          TEXT FK mcp_clients(client_id) ON DELETE CASCADE
  scopes             TEXT           -- space-joined
  created_at         REAL
  last_used_at       REAL NULL
  UNIQUE (user_id, client_id)

mcp_authorization_codes
  code_hash          TEXT PK
  grant_id           TEXT FK mcp_grants(id) ON DELETE CASCADE
  redirect_uri       TEXT
  code_challenge     TEXT
  resource           TEXT NULL
  expires_at         REAL

mcp_tokens
  token_hash         TEXT PK
  grant_id           TEXT FK mcp_grants(id) ON DELETE CASCADE
  kind               TEXT           -- 'access' | 'refresh'
  expires_at         REAL
  created_at         REAL
  INDEX (grant_id), INDEX (expires_at)
```

A grant is created at consent time (so the code can reference it) and is what
the Settings list shows. A grant with no live tokens is still listed — the
reader approved it — until they disconnect it or until it is swept: expired
codes and tokens are deleted on every token-endpoint call (same sweep-on-write
shape as `deleteExpired`), and a grant whose code expired unconsumed and that
never received a token is deleted in the same sweep.

## OAuth flow

1. Client GETs `/.well-known/oauth-protected-resource/mcp` (or gets a 401 from
   `/mcp` with `WWW-Authenticate: Bearer resource_metadata=...`) and then
   `/.well-known/oauth-authorization-server`.
2. Client POSTs `/mcp/oauth/register` → `mcp_clients` row; response is the
   SDK's standard registration response.
3. Client opens `/mcp/oauth/authorize?...`. The SDK handler validates
   `client_id`, `redirect_uri`, `response_type=code`, `code_challenge_method=
   S256`, then calls `provider.authorize`, which 302s to
   `/connect?client_id&redirect_uri&code_challenge&state&scope&resource`.
4. The SPA's `ProtectedRoute` sends an anonymous visitor to `/login` and back
   (the existing `state.from` round-trip preserves the query string). `/connect`
   reads the client's name and URL via a GraphQL query `mcpClient(clientId)`
   (name, uri, logo, requested scopes rendered as plain English) and shows
   Approve / Deny. An admin viewer sees a refusal card instead.
5. Approve → mutation `mcpAuthorize(input: {clientId, redirectUri,
   codeChallenge, state, scope, resource, approve: true, readOnly: false})`.
   The resolver re-validates client and redirect URI (same `redirectUriMatches`
   rule the SDK exports), computes the granted scopes (requested ∩ supported,
   or both when nothing was requested; `library:read` alone when `readOnly`),
   upserts the grant for (viewer, client) with those scopes, deletes the
   grant's previous tokens, stamps `mcp_clients.last_granted_at`, writes a
   code, and returns `{ redirectUrl }`. Deny returns `redirectUrl` with
   `error=access_denied`. The SPA assigns `window.location`.
6. Client POSTs `/mcp/oauth/token` with `grant_type=authorization_code`. The
   SDK verifies PKCE via `provider.challengeForAuthorizationCode`, then
   `exchangeAuthorizationCode` consumes the code (single `DELETE ... RETURNING`
   like `consumeRefreshToken`), checks `redirect_uri`/`resource` match what the
   code was bound to, and mints access + refresh tokens.
7. `/mcp` requests carry `Authorization: Bearer <access>`. `requireBearerAuth`
   calls `provider.verifyAccessToken`, which looks the hash up, checks expiry,
   loads the grant's user, and returns `AuthInfo` with
   `extra: { userId, username, grantId }`.
8. `grant_type=refresh_token` rotates the refresh token and mints a new access
   token. Scopes cannot be widened on refresh.

## Tools

Naming is `snake_case`, verbs first. Every tool returns `structuredContent`
(typed JSON, declared via `outputSchema`) and a short text rendering of the same
data. Book and series identifiers are the GraphQL global IDs, returned by every
listing and accepted by every tool that takes one; the raw content hash is
exposed as `documentId` for display only, matching the schema. Annotations:
read tools `readOnlyHint: true`; `delete_book` `destructiveHint: true`;
everything else `idempotentHint` as appropriate.

Read (`library:read`):

| Tool | Backs onto | Notes |
| --- | --- | --- |
| `search_library` | `Library.entries(filter, first, after)` | Args: `query`, `author`, `seriesName`, `subjects[]`, `status`, `entryType`, `first` (≤ 50), `after`. Returns a page of entries, each a book summary or a series summary, plus `nextCursor`. |
| `get_book` | `Library.book(id)` | Full metadata, cover/download URLs, series, `validation` summary (valid, threshold, counts, validatedAt), `pendingFix` proposals (field, kind, from, to, reason, key), lineage, reading progress. |
| `get_series` | `Library.seriesByName` / `node(id)` | By `id` or `name`. Series metadata plus its books in series order. |
| `list_series` | `Library.series` | Name, id, author, bookCount, progress. |
| `list_library_facets` | `Library.subjects`, `Library.authors` | For an assistant choosing filters. |
| `list_pending_fixes` | `Library.pendingFixes` | Every book with outstanding recommendations and the proposals on each. |
| `get_validation_report` | `Book.validation.messages` | Paged messages (`first` ≤ 100, `after`). |
| `list_reading_progress` | `Library.progress` | Newest first, paged. |
| `get_book_cover` | REST cover bytes via `getThumbnail`/`getCover` | Returns an `image` content block (JPEG), `width` optional. |
| `list_book_requests` | `User.bookRequests` | The reader's own requests and their status. |

Write (`library:write`):

| Tool | Backs onto | Notes |
| --- | --- | --- |
| `update_book_metadata` | `bookUpdateMetadata` | Any subset of title, titleSort, author, authorSort, description, publisher, publishDate, series, seriesIndex, subjects, identifiers. Returns the updated book (its id may change, since the id is a content hash — the response says so). |
| `validate_book` | `bookValidate` | Returns the new report summary. |
| `resolve_metadata_fixes` | `bookResolvePendingFix` | `action`: ACCEPT, DISMISS, UNDO, CLEAR; optional `fixes[]` of `{field, kind, from}` keys for ACCEPT/DISMISS. |
| `upload_book` | shared import function (see Binary seams) | `url` or `contentBase64`, plus `filename`. Returns the new book, applied auto-fixes, and proposals. Validation failure returns the report as a tool error with `isError: true`. |
| `stage_replacement` | `replaceStaging.stage` + `bookAnalyzeReplace` | `bookId` + `url`/`contentBase64`. Returns `stagedUploadId`, validity, report summary, and the detected fixes with keys. |
| `replace_book_file` | `bookReplace` | `bookId`, `stagedUploadId`, `acceptedFixKeys[]`. |
| `regenerate_chapters` | `bookRegenChapters` | Cheap and already exists. |
| `delete_book` | `bookDelete` | Destructive; annotated so clients confirm. |
| `request_book` | `bookRequestCreate` | Title, author, note — asks the admin. |

Errors: a typed GraphQL error member (e.g. `BookNotValidatedError`,
`InvalidInputError`) becomes an `isError: true` text result naming the error
and its message; a null "no such book" becomes "No book with that id in your
library". A GraphQL `FORBIDDEN`/`UNAUTHENTICATED` cannot normally occur (the
viewer is the grant's user) but is rendered the same way if it does. A viewer
with `mustChangePassword` or `mustSetEmail` set gets, from every tool, "Finish
setting up your Bookplate account in the web app first."

## Settings UI

`component/mcp-connections`, mounted on `page/settings` in the reader branch
between `ConnectionUrls` and `EmailSetting`. Data comes from a new
`McpConnectionsFragment on Viewer { mcpEnabled mcpUrl mcpConnections { id
clientName clientUri logoUri scopes createdAt lastUsedAt } }` composed into
`UserPageDocument` (the route's one document). Card title "AI assistants".
Body: just the MCP URL pill (copy button). A blue link-button reading "clients"
in the card header opens a modal ("Connected clients") listing the connections,
each with name (linking to `clientUri` when present), "Connected <date> · Last
used <date|never>", a scope tag ("Read only" / "Read & write"), and a
Disconnect link-button that opens the shared `ConfirmModal`. Disconnect
runs `viewerRevokeMcpConnection` and refetches `UserPageDocument`. Empty state:
"No assistants connected yet." When `mcpEnabled` is false (no https
`public_url`) the reader's card renders nothing at all — a reader cannot change
that setting, so a hint would only confuse. The ADMIN's settings branch gets its
own `component/mcp-setup` card instead: when MCP is off it explains that
readers will not see the option until `public_url` is set to the https origin
in the add-on's Configuration tab and the add-on restarted; when on, it shows
the connection URL readers paste into their assistant. It reads a small
`McpStatus` query of its own, since the admin branch sends no
`UserPageDocument`.

`page/connect`: a `Page type="minimal"` with `BrandLockup` and a `Card`. Body,
top to bottom: title "Connect <client name>?" and a one-line subtitle ("<client>
is asking to use your Bookplate library."), a divider, a "Read only" `Switch`
(no helper text), a divider, then what the assistant will be able to do as a
list with small grey check icons (derived from the scopes that would be
granted; the write line drops when Read only is on). Deny (default) and Approve
(primary) sit in the card footer.
Bad or missing query params render a card saying the link is invalid. An admin
viewer sees "The admin account has no library to connect. Sign in as a reader."

## Server layout

```
app/server/mcp/
  index.ts              createMcpRouter(deps) → Express Router (mounted at root
                         by server.ts; owns /mcp, /mcp/oauth/*, /.well-known/*)
  oauth-provider.ts     Prisma-backed OAuthServerProvider + clients store
  oauth-metadata.ts     builds the OAuthMetadata with /mcp/oauth paths
  tokens.ts             hashing, minting, consuming, sweeping
  viewer.ts             AuthInfo → Viewer (reads the two gate flags)
  server.ts             buildMcpServer(viewer, deps): registers every tool
  tools/*.ts            one file per tool: zod input, GraphQL document, formatter
  tools/execute.ts      run a GraphQL document in-process for a viewer
  fetch-epub.ts         URL fetch with the private-host guard and caps
app/server/services/mcp-connection.ts   grant listing / revocation for GraphQL
app/server/services/import-epub.ts      extracted from routes/ui.ts upload loop
app/server/utils/private-host.ts        isPrivateHost moved out of add-push-subscription
app/server/utils/client-ip.ts           resolveLoginClientIp moved out of routes/ui.ts
app/server/graphql/schema/mcp-connection/   Viewer.mcpConnections, mcpEnabled,
                                            mcpUrl, Query.mcpClient, mutations
app/client/src/component/mcp-connections/
app/client/src/page/connect/
app/client/src/graphql/mcp.ts
```

`graphql/context.ts` gains `createContextForViewer(deps, viewer)`; the yoga
factory and the MCP executor both call it, so the `Context` shape stays
spelled out once (the same reason `test-util.ts`'s `contextFor` exists).

## Configuration and docs

- `public_url` becomes the switch for MCP as well as email links. README's
  option table row is extended, and a new "Connect an AI assistant (MCP)"
  subsection under Usage explains: set `public_url` (https), add
  `<public_url>/mcp` as a custom connector in Claude, approve in the browser,
  disconnect from Settings.
- `vite.config.ts` (client) proxies `/mcp` and `/.well-known` to the API in
  dev, so `PUBLIC_URL=http://localhost:5173` gives a working local flow
  (the SDK's localhost exemption covers the http issuer).
- No `config.yaml` option is added.

## Testing

- `mcp/oauth-provider.test.ts`: register → authorize-code → PKCE exchange →
  refresh rotation → revoke, against a real temp SQLite via the GraphQL
  harness's Prisma; wrong verifier, reused code, expired token, mismatched
  redirect URI and resource all refused; a refresh asking for `library:write`
  on a read-only grant refused; the sweep removes a never-granted client after
  24 h and keeps a granted one.
- `mcp/fetch-epub.test.ts`: refuses `http:`, a private IP literal, a hostname
  that resolves to a private address (injected `lookup`), a redirect to a
  private address, a body over the cap, and a non-EPUB content type; follows
  one public redirect.
- `mcp/server.test.ts`: end-to-end through the SDK's `Client` +
  `StreamableHTTPClientTransport` against the Express app on an ephemeral
  port: `tools/list` names every tool; `search_library`/`get_book`/
  `update_book_metadata`/`resolve_metadata_fixes`/`validate_book` round-trip
  on a seeded library; a `library:read` token is refused by a write tool; bob's
  token never sees alice's book; a gated viewer gets the setup message.
- `graphql/schema/mcp-connection/*.test.ts`: `Viewer.mcpConnections` lists only
  the viewer's grants; revoke deletes tokens; `mcpAuthorize` refuses an
  unregistered redirect URI and an admin viewer.
- `services/import-epub.test.ts` + the existing `routes/ui.test.ts` upload
  suite, unchanged, prove the extraction.
- Client: `component/mcp-connections/index.test.tsx` (list, empty state,
  disconnect confirm → mutation → refetch, disabled-MCP hint) and
  `page/connect/index.test.tsx` (renders client name, approve calls mutation and
  assigns location, admin refusal, invalid params). `root-auth.test.ts` and
  `rest-seams.test.ts` keep passing with no edits (the consent page uses
  GraphQL, not REST).

## Left to the builder

- Exact zod shapes and text renderings per tool, as long as every field named
  in the Tools tables is present.
- Whether `get_series` resolves `name` through `seriesByName` or a filtered
  `entries` call.
- Table/field naming inside the Prisma models beyond the columns listed.
- Whether the consent page shows `logo_uri` (it may be absent or hostile; the
  builder may choose to omit it).
- Whether the `/mcp` JSON parser is a route-level middleware or the first
  handler inside the MCP router, as long as the global parser never sees the
  body first.
- The exact minute-level throttle for `last_used_at`.
