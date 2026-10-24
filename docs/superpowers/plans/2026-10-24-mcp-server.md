# MCP Server with OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server at `POST /mcp`, protected by Bookplate's own OAuth 2.1 authorization server, exposing library tools that run the existing GraphQL schema in-process, plus a Settings card to see and disconnect connected assistants.

**Architecture:** The `@modelcontextprotocol/sdk` handlers (authorize, token, register, revoke, metadata, bearer auth) are mounted under `/mcp/oauth/*` and `/.well-known/*` against a Prisma-backed `OAuthServerProvider` that stores opaque hashed tokens. Each `/mcp` request builds a stateless `McpServer` whose tools execute fixed GraphQL documents with a `Context` built for the grant's user, so tenancy is the schema's. The SPA gets a `/connect` consent page and an "AI assistants" settings card driven by new `Viewer` fields and mutations.

**Tech Stack:** TypeScript (CommonJS server), Express 5, Prisma 7 + better-sqlite3, Pothos GraphQL, `@modelcontextprotocol/sdk` 1.32.2, zod 4, React 19 + Apollo Client 4, Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-24-mcp-server-design.md`

## Global Constraints

- Server code is CommonJS; import SDK subpaths as `@modelcontextprotocol/sdk/server/<module>.js`.
- Tables with a foreign key to `users` are created in `db/migrate.ts` (`data_v23_mcp`), and `prisma/migrations/20261025000000_add_mcp/migration.sql` is an intentionally-empty file with the push-subscriptions comment adapted.
- Scopes are exactly `library:read` and `library:write`; a request naming none asks for both; consent "Read only" grants `library:read` alone; scopes never widen on refresh.
- Token TTLs: access 1 h, refresh 30 d, authorization code 10 min, never-granted client rows 24 h. Tokens are 32 random bytes base64url; only SHA-256 hex hashes are stored (reuse `services/token.ts`'s `hashToken`).
- OAuth paths: `/mcp/oauth/authorize`, `/mcp/oauth/token`, `/mcp/oauth/register`, `/mcp/oauth/revoke`; metadata at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`; consent at SPA route `/connect`.
- MCP is mounted only when `resolveMcpBaseUrl(config.publicUrl)` returns a URL (https, or http on `localhost`/`127.0.0.1`); otherwise one `warn` log line and nothing is mounted. `Viewer.mcpEnabled` is false and `Viewer.mcpUrl` null in that case.
- `/mcp` has its own `express.json({ limit: '8mb' })`, mounted in `server.ts` ahead of the global `express.json()`.
- URL fetch: https only, resolve-then-pin through `isPrivateHost`, max 5 redirects each re-checked, 200 MB cap, 30 s budget, `application/epub+zip` or a path ending in `.epub`.
- OAuth rate limiters keyed by `resolveLoginClientIp(req, config.trustProxyHops ?? 0)` with `validate: { xForwardedForHeader: false }`.
- Lint rules: no `any`, no `@ts-` comments, `eqeqeq`, `no-shadow`, unused vars prefixed `_`. Run `npm run lint -w app/server` / `-w app/client` before each commit that touches that workspace; regenerate SDL with `npm run graphql:schema -w app/server` and client types with `npm run codegen -w app/client` whenever the schema changes.
- Client components use `createUseStyles` with the `Theme` tokens; no hard-coded colours or sizes.

## Review Focus

1. A reader deleted while an assistant holds a live token: the next `/mcp` call must be a 401, not a 500. Test in Task 4 (provider: `verifyAccessToken` rejects after `deleteUser`).
2. Re-authorizing the same client (Claude.ai "reconnect"): the previous tokens must stop working immediately and the Settings list must still show one row. Test in Task 7 (`mcpAuthorize` twice → first access token rejected, `mcpConnections.length === 1`).
3. A tool given a malformed id, a `Series` id where a `Book` id is expected, or another reader's book id must answer "No book with that id in your library", never throw. Test in Task 10 (`get_book` with bob's id from alice's token and with `"garbage"`).
4. `/connect` opened with an unknown or swept `client_id`: the page shows the invalid-link card and `mcpAuthorize` returns `InvalidInputError`, never a redirect. Tests in Task 7 (server) and Task 14 (client).
5. A `contentBase64` body over 8 MB: `/mcp` answers 413 JSON promptly rather than timing out or crashing the process. Test in Task 5.

---

### Task 1: Extract the private-host and client-IP helpers

**Files:**
- Create: `app/server/utils/private-host.ts`, `app/server/utils/private-host.test.ts`
- Create: `app/server/utils/client-ip.ts`
- Modify: `app/server/graphql/schema/viewer/mutation/add-push-subscription.ts` (delete the inline `isPrivateHost`/`isPublicHttpsUrl`, import them)
- Modify: `app/server/routes/ui.ts` (delete `resolveLoginClientIp`, import it), `app/server/routes/ui.test.ts` if it imports it

**Interfaces:**
- Produces: `isPrivateHost(hostname: string): boolean`, `isPublicHttpsUrl(value: string): boolean` from `utils/private-host.ts`; `resolveLoginClientIp(req: Request, trustProxyHops: number): string` from `utils/client-ip.ts`.

- [ ] **Step 1: Write `utils/private-host.test.ts`** with cases: `localhost`, `nas.local`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.1.1`, `[::1]`, `::ffff:c0a8:101`, `fd00::1`, `fe80::1`, bare `homeassistant` → `true`; `books.example.com`, `1.1.1.1`, `2606:4700::1111` → `false`; `isPublicHttpsUrl('https://1.1.1.1/x')` true, `http://...` false.
- [ ] **Step 2: Run** `npx vitest run utils/private-host -w app/server` → FAIL (module missing).
- [ ] **Step 3: Move the two functions and `PRIVATE_HOST_SUFFIXES` verbatim** into `utils/private-host.ts`; export both; update the mutation's import. Move `resolveLoginClientIp` verbatim into `utils/client-ip.ts` and re-export it from `routes/ui.ts` only if a test imports it from there.
- [ ] **Step 4: Run** `npm test -w app/server -- utils/ routes/ui graphql/schema/viewer/push-fields` → PASS; `npm run lint -w app/server` → clean.
- [ ] **Step 5: Commit** `refactor(server): move private-host and client-ip helpers into utils`.

### Task 2: Data model

**Files:**
- Modify: `app/server/prisma/schema.prisma` (four models + `User.mcpGrants`)
- Modify: `app/server/db/migrate.ts` (append `data_v23_mcp`)
- Create: `app/server/prisma/migrations/20261025000000_add_mcp/migration.sql` (comment only)
- Test: `app/server/db/migrate.test.ts`

**Interfaces:**
- Produces Prisma models: `McpClient { clientId @id, clientSecret?, clientIdIssuedAt: Float, clientSecretExpiresAt?: Float, lastGrantedAt?: Float, metadata: String, createdAt: Float }` → `mcp_clients`; `McpGrant { id @id, userId, clientId, scopes: String, createdAt, lastUsedAt? }` → `mcp_grants`, `@@unique([userId, clientId])`, FK user cascade/cascade, FK client cascade; `McpAuthorizationCode { codeHash @id, grantId, redirectUri, codeChallenge, resource?, expiresAt }` → `mcp_authorization_codes`; `McpToken { tokenHash @id, grantId, kind: String, expiresAt, createdAt }` → `mcp_tokens`, `@@index([grantId])`, `@@index([expiresAt])`. Column names snake_case via `@map`.

- [ ] **Step 1: Add a test to `migrate.test.ts`**: after `runMigrations` on a fresh db, `PRAGMA table_info` lists `mcp_clients`, `mcp_grants`, `mcp_authorization_codes`, `mcp_tokens` with the columns above, and inserting a grant then deleting its user removes the grant (cascade works under this adapter).
- [ ] **Step 2: Run** `npx vitest run db/migrate -w app/server` → FAIL.
- [ ] **Step 3: Write `data_v23_mcp`** with `CREATE TABLE IF NOT EXISTS` for the four tables in dependency order (same shape as `data_v21_push_subscriptions`), the unique index on `(user_id, client_id)` and the two `mcp_tokens` indexes; add the Prisma models; add the empty migration file; run `npm run prisma:generate -w app/server`.
- [ ] **Step 4: Run** the test → PASS; `npm run lint -w app/server` → clean.
- [ ] **Step 5: Commit** `feat(server): add MCP client, grant, code and token tables`.

### Task 3: Token and grant persistence

**Files:**
- Create: `app/server/mcp/tokens.ts`, `app/server/mcp/tokens.test.ts`

**Interfaces:**
- Produces (all take `prisma: PrismaClient` first; times are ms epoch, `now` injectable with default `Date.now`):
  - `SCOPES = ['library:read', 'library:write'] as const`, `type McpScope`, `resolveGrantedScopes(requested: string[] | undefined, readOnly: boolean): McpScope[]` (unknown scopes dropped; empty request → both; `readOnly` → `['library:read']`; throws `RangeError` if the result is empty).
  - `ACCESS_TOKEN_TTL_MS`, `REFRESH_TOKEN_TTL_MS`, `CODE_TTL_MS`, `UNGRANTED_CLIENT_TTL_MS`.
  - `upsertGrant(prisma, { userId, clientId, scopes }): Promise<{ id: string }>` — deletes the grant's existing tokens and codes, stamps `McpClient.lastGrantedAt`.
  - `createAuthorizationCode(prisma, { grantId, redirectUri, codeChallenge, resource }): Promise<string>`.
  - `peekAuthorizationCode(prisma, code): Promise<{ codeChallenge: string; clientId: string } | null>` (unexpired only).
  - `consumeAuthorizationCode(prisma, code): Promise<{ grantId; clientId; userId; scopes: McpScope[]; redirectUri; resource: string | null } | null>` — single `DELETE … RETURNING`, expired → null.
  - `issueTokens(prisma, grantId, scopes): Promise<OAuthTokens>` (`{ access_token, token_type: 'bearer', expires_in: 3600, refresh_token, scope }`).
  - `consumeRefreshToken(prisma, raw): Promise<{ grantId; clientId; scopes } | null>`.
  - `lookupAccessToken(prisma, raw): Promise<{ grantId; clientId; userId; username; scopes; expiresAt } | null>` (joins grant → user; null when expired or the user row is gone).
  - `revokeToken(prisma, raw): Promise<void>`, `touchGrant(prisma, grantId): Promise<void>` (writes `lastUsedAt` only if null or older than 60 s), `sweepExpired(prisma): Promise<void>` (expired codes and tokens; grants with no tokens and no live code older than `CODE_TTL_MS`; clients with `lastGrantedAt IS NULL` and `createdAt` older than 24 h).

- [ ] **Step 1: Write `tokens.test.ts`** using `createHarness()` for a Prisma + alice: `resolveGrantedScopes` table; grant upsert twice keeps one row and invalidates the first `issueTokens` access token; code consume is single-use and refuses after `CODE_TTL_MS`; refresh rotates (old refresh → null on second use); `lookupAccessToken` null after `deleteUser`; `touchGrant` throttles within 60 s; `sweepExpired` removes a 25 h-old ungranted client and keeps a granted one.
- [ ] **Step 2: Run** `npx vitest run mcp/tokens -w app/server` → FAIL.
- [ ] **Step 3: Implement `mcp/tokens.ts`** with the signatures above; `hashToken` imported from `services/token.ts`; raw tokens from `crypto.randomBytes(32).toString('base64url')`; grant ids from `utils/id.ts`'s nanoid helper if one exists, else `nanoid()`.
- [ ] **Step 4: Run** the test → PASS; lint clean.
- [ ] **Step 5: Commit** `feat(server): MCP grant, code and token persistence`.

### Task 4: OAuth provider and clients store

**Files:**
- Create: `app/server/mcp/oauth-provider.ts`, `app/server/mcp/oauth-provider.test.ts`
- Create: `app/server/mcp/base-url.ts`, `app/server/mcp/base-url.test.ts`

**Interfaces:**
- Consumes Task 3.
- Produces: `resolveMcpBaseUrl(publicUrl: string | null | undefined): URL | null` (https always; http only for `localhost`/`127.0.0.1`; strips a trailing slash; null otherwise). `createOAuthProvider({ prisma, baseUrl: URL }): OAuthServerProvider` whose `clientsStore.registerClient` stores the SDK-generated client in `McpClient` (`metadata` = JSON of the full `OAuthClientInformationFull`), `getClient` reads it back, `authorize` 302s to `${baseUrl}/connect?client_id&redirect_uri&code_challenge&state&scope&resource` (only defined params), `challengeForAuthorizationCode` uses `peekAuthorizationCode` and throws `InvalidGrantError` when null or the code belongs to another client, `exchangeAuthorizationCode` consumes the code, throws `InvalidGrantError` on client/redirect/resource mismatch, then `sweepExpired` + `issueTokens`, `exchangeRefreshToken` rotates and refuses scopes outside the grant with `InvalidScopeError`, `verifyAccessToken` returns `AuthInfo { token, clientId, scopes, expiresAt (s), extra: { userId, username, grantId } }` or throws `InvalidTokenError`, `revokeToken` deletes the presented token. Errors come from `@modelcontextprotocol/sdk/server/auth/errors.js`.

- [ ] **Step 1: Write `base-url.test.ts`** (`https://books.example/` → `https://books.example`, `http://localhost:5173` kept, `http://192.168.1.5:3000` → null, `''`/null → null).
- [ ] **Step 2: Write `oauth-provider.test.ts`**: build an Express app with `authorizationHandler`, `tokenHandler`, `clientRegistrationHandler({ clientSecretExpirySeconds: 0 })`, `revocationHandler` from the SDK mounted at the spec paths with `rateLimit: false`; with supertest: register → `GET /mcp/oauth/authorize?...S256` → 302 whose `Location` starts with `${baseUrl}/connect?` and carries every param; mint a grant+code directly via Task 3 for alice; `POST /mcp/oauth/token` with the right verifier → 200 tokens; wrong verifier → 400 `invalid_grant`; second use of the code → 400; redirect_uri mismatch → 400; refresh → new pair and old refresh refused; refresh requesting `library:write` on a read-only grant → 400 `invalid_scope`; `verifyAccessToken(access)` resolves `extra.userId === alice`; after `deleteUser(alice)` it rejects; `POST /mcp/oauth/revoke` then `verifyAccessToken` rejects.
- [ ] **Step 3: Run** both → FAIL.
- [ ] **Step 4: Implement `base-url.ts` and `oauth-provider.ts`.**
- [ ] **Step 5: Run** → PASS; lint clean.
- [ ] **Step 6: Commit** `feat(server): Prisma-backed OAuth provider for MCP`.

### Task 5: MCP router skeleton and server wiring

**Files:**
- Create: `app/server/mcp/oauth-metadata.ts`, `app/server/mcp/index.ts`, `app/server/mcp/index.test.ts`
- Modify: `app/server/server.ts` (accept `mcpRouter: Router | null`, mount it right after `/graphql` and before `express.json()`), `app/server/index.ts` (build it), `app/server/graphql/context.ts` (`ContextDeps.mcpUrl: string | null`, `Context.mcpUrl`), `app/server/graphql/test-util.ts` (`createHarness({ mcpUrl })`, default `'https://books.example/mcp'`; expose `harness.contextDeps: ContextDeps`)

**Interfaces:**
- Consumes Task 4.
- Produces: `buildOAuthMetadata(baseUrl: URL): OAuthMetadata` (issuer = baseUrl, endpoints under `/mcp/oauth`, `scopes_supported: SCOPES`, `token_endpoint_auth_methods_supported: ['client_secret_post','none']`, `code_challenge_methods_supported: ['S256']`, `grant_types_supported: ['authorization_code','refresh_token']`). `createMcpRouter(deps: McpRouterDeps): Router` with `McpRouterDeps = { baseUrl: URL; prisma; config: AppConfig; contextDeps: ContextDeps; thumbnails: ThumbnailQueue; replaceStaging: ReplaceStaging; editionsRoot: string; handleMcp?: (req, res) => Promise<void> }` — this task mounts: the SDK handlers at the four OAuth paths (rate limiters keyed per Global Constraints), `mcpAuthMetadataRouter`, and `POST /mcp` = `express.json({ limit: '8mb' })` → `requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL('/mcp', baseUrl)) })` → a placeholder that answers 501 until Task 10 replaces it. `mcpUrl(baseUrl): string` = `${baseUrl}/mcp`.

- [ ] **Step 1: Write `mcp/index.test.ts`** against `createServer` with a router from `createMcpRouter`: `GET /.well-known/oauth-authorization-server` → issuer and the four endpoint URLs; `GET /.well-known/oauth-protected-resource/mcp` → `resource` = `${base}/mcp`, `authorization_servers: [base]`; `POST /mcp` with no token → 401 with `WWW-Authenticate` containing `resource_metadata=`; `POST /mcp` with a 9 MB JSON body and a valid token → 413 JSON; `GET /api/public-config` still 200 (SPA untouched).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, wire `index.ts` (`const mcpBase = resolveMcpBaseUrl(config.publicUrl)`; log `warn('MCP disabled: set public_url to an https origin')` when null; pass `mcpUrl` into `createGraphqlHandler`), and extend the harness.
- [ ] **Step 4: Run** `npm test -w app/server` → PASS (the harness change must not break any suite); lint clean.
- [ ] **Step 5: Commit** `feat(server): mount the MCP OAuth endpoints and metadata`.

### Task 6: Context factory and MCP viewer

**Files:**
- Modify: `app/server/graphql/context.ts` (add `createContextForViewer(deps: ContextDeps, viewer: Viewer | null): Context`; `createContext` and `test-util.ts`'s `contextFor` call it)
- Create: `app/server/mcp/viewer.ts`, `app/server/mcp/viewer.test.ts`

**Interfaces:**
- Produces: `viewerFromAuthInfo({ prisma, config }, auth: AuthInfo): Promise<Viewer | null>` — reads `extra.userId`/`extra.username`, returns `{ userId, username, isAdmin: false, mustChangePassword: await getMustChangePassword(prisma, username), mustSetEmail: await computeMustSetEmail(prisma, config, { username }) }`, null when `extra` lacks a userId or the user row is gone. `SETUP_REQUIRED_MESSAGE = 'Finish setting up your Bookplate account in the web app first.'` and `isSetupComplete(viewer): boolean`.

- [ ] **Step 1: Write `viewer.test.ts`**: alice → flags false; after `resetPassword` (forces change) → `mustChangePassword` true and `isSetupComplete` false; mail configured + no email → `mustSetEmail` true; deleted user → null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `computeMustSetEmail` is imported from `routes/ui.ts` (already exported). **Step 4: Run** `npm test -w app/server -- graphql/context mcp/viewer` → PASS; lint clean.
- [ ] **Step 5: Commit** `feat(server): build a GraphQL viewer from an MCP access token`.

### Task 7: GraphQL surface — connections, consent, revoke

**Files:**
- Create: `app/server/services/mcp-connection.ts` (`listMcpConnections(prisma, userId): Promise<McpConnectionRow[]>` joining client metadata; `revokeMcpConnection(prisma, { userId, id }): Promise<boolean>`; `getMcpClient(prisma, clientId): Promise<OAuthClientInformationFull | null>`)
- Create: `app/server/graphql/schema/mcp-connection/{index.ts,model.ts,client-model.ts,query/client.ts,mutation/authorize.ts,mutation/revoke.ts}` and tests `model.test.ts`, `authorize.test.ts`, `revoke.test.ts`
- Modify: `app/server/graphql/schema/viewer/model.ts` (fields `mcpEnabled: Boolean!`, `mcpUrl: String` nullable, `mcpConnections: [McpConnection!]!`), `app/server/graphql/schema/index.ts` (import), regenerate `schema.generated.graphql`

**Interfaces:**
- SDL produced: `type McpConnection { id: ID!, clientName: String!, clientUri: String, logoUri: String, scopes: [String!]!, createdAt: DateTime!, lastUsedAt: DateTime }`; `type McpClientInfo { clientId: String!, clientName: String!, clientUri: String, logoUri: String }`; `Query.mcpClient(clientId: String!): McpClientInfo`; `input McpAuthorizeInput { clientId: String!, redirectUri: String!, codeChallenge: String!, state: String, scope: String, resource: String, approve: Boolean!, readOnly: Boolean! }`; `union McpAuthorizeResult = McpAuthorizePayload | InvalidInputError`, `type McpAuthorizePayload { redirectUrl: String! }`; `Mutation.mcpAuthorize(input: McpAuthorizeInput!): McpAuthorizeResult!`; `Mutation.viewerRevokeMcpConnection(id: ID!): Boolean!`. `clientName` falls back to `"Unnamed client"`. `mcpAuthorize` refuses (InvalidInputError, message as given) an admin viewer ("The admin account has no library to connect"), an unknown client ("Unknown client"), a redirect URI failing `redirectUriMatches` ("Unregistered redirect URI"), and `mcpUrl === null` ("MCP is not enabled"); on `approve: false` it returns the redirect URI with `error=access_denied` (+ `state`); on approve it calls `resolveGrantedScopes`, `upsertGrant`, `createAuthorizationCode`, and returns `redirectUri?code=…&state=…`.

- [ ] **Step 1: Write the three tests** with the harness: `viewer { mcpEnabled mcpUrl }` true/url by default and false/null with `createHarness({ mcpUrl: null })`; alice's connections list only alice's grants (bob's absent) with `clientName` from metadata; `mcpAuthorize` approve → `redirectUrl` parses with `code` and `state`, and `peekAuthorizationCode(code)` returns the challenge; `readOnly: true` → the grant's scopes are `library:read`; approving twice → one connection and the first `issueTokens` access token now fails `lookupAccessToken`; deny → `error=access_denied`; unknown client, unregistered redirect, admin viewer → `InvalidInputError` with the messages above; `viewerRevokeMcpConnection` deletes the grant and its tokens and returns false for bob's id; `root-auth.test.ts` and `node-scope.test.ts` still pass.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (model files follow `push-subscription/model.ts` and `viewer/mutation/remove-push-subscription.ts`); `npm run graphql:schema -w app/server`. **Step 4: Run** `npm test -w app/server` → PASS; lint clean (includes `graphql:schema:check`).
- [ ] **Step 5: Commit** `feat(graphql): MCP connections, consent mutation and revoke`.

### Task 8: Extract the EPUB import function

**Files:**
- Create: `app/server/services/import-epub.ts`, `app/server/services/import-epub.test.ts`
- Modify: `app/server/routes/ui.ts` (`POST /api/books/upload` loop body calls it; status mapping stays in the route), `app/server/graphql/schema/node-scope.ts` (add `encodeBookGlobalId(userId: string, bookId: string): string`), use it in `ui.ts`'s `bookGlobalId` and `book/mutation/delete.ts`

**Interfaces:**
- Produces: `type ImportEpubDeps = { prisma; config: AppConfig; editionsRoot: string; thumbnailQueue: ThumbnailQueue }`; `type ImportEpubResult = { kind: 'imported'; bookId: string; applied: MetadataFix[]; proposals: MetadataFix[] } | { kind: 'parse_failed'; message: string } | { kind: 'fingerprint_failed'; message: string } | { kind: 'invalid'; validation: { messages: ValidationReport['messages']; counts: ValidationReport['counts']; threshold: ValidationReport['threshold'] } } | { kind: 'duplicate' }`; `importEpub(deps, owner: Owner, file: { path: string; originalName: string; size: number }): Promise<ImportEpubResult>` — on every non-`imported` outcome and on an unexpected throw the staged file is unlinked first. Route mapping: `parse_failed`/`fingerprint_failed` → 400 `{ error }`, `invalid` → 400 `{ error: 'EPUB failed validation', validation }`, `duplicate` → 409 (existing message), `imported` → push the result row with `globalId: encodeBookGlobalId(owner.userId, bookId)`.

- [ ] **Step 1: Write `import-epub.test.ts`**: imports `fixtureEpub` (from `book/mutation/test-helpers.ts`) written to a temp staging path → `imported` with a `Book` row; same bytes twice → `duplicate` and the file is gone; a non-zip file → `parse_failed` and the file is gone; the epub-validator mock returning invalid → `invalid` with the report.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement by moving the loop body**; the route becomes a thin mapping. **Step 4: Run** `npm test -w app/server -- services/import-epub routes/ui graphql/schema/book` → PASS (every existing upload test unchanged); lint clean.
- [ ] **Step 5: Commit** `refactor(server): extract the EPUB import pipeline from the upload route`.

### Task 9: Guarded EPUB fetch

**Files:**
- Create: `app/server/mcp/fetch-epub.ts`, `app/server/mcp/fetch-epub.test.ts`

**Interfaces:**
- Produces: `class FetchEpubError extends Error { code: 'invalid_url' | 'private_host' | 'too_many_redirects' | 'too_large' | 'not_epub' | 'http_error' | 'timeout' }`; `type FetchEpubOptions = { lookup?: LookupFunction (node:dns `lookup` signature); maxBytes?: number (default 200 MiB); timeoutMs?: number (default 30 000); maxRedirects?: number (default 5); request?: typeof https.request }`; `fetchEpub(url: string, options?): Promise<{ bytes: Buffer; filename: string }>` — `filename` from `Content-Disposition` if present, else the final URL's last path segment, forced to end in `.epub`. Hostnames are resolved via `options.lookup ?? dns.lookup` with `{ all: true }`; any private address → `private_host`; the request connects to the pinned address with `servername`/`Host` set to the hostname. Non-2xx → `http_error`; 3xx handled manually.

- [ ] **Step 1: Write the test** with a local `https` server is awkward, so use an injected `request` stub that returns scripted responses, plus an injected `lookup`: `http://` → `invalid_url`; `https://10.0.0.1/a.epub` → `private_host`; `https://evil.example` whose lookup yields `127.0.0.1` → `private_host`; redirect to `https://192.168.0.1/x.epub` → `private_host`; six redirects → `too_many_redirects`; body of `maxBytes + 1` → `too_large` and the stream is destroyed; `content-type: text/html` with a `.html` path → `not_epub`; one public redirect then 200 `application/epub+zip` → bytes and filename.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; lint clean.
- [ ] **Step 5: Commit** `feat(server): SSRF-guarded EPUB download for MCP uploads`.

### Task 10: MCP server, executor, and read tools

**Files:**
- Create: `app/server/mcp/tools/execute.ts`, `app/server/mcp/server.ts`, `app/server/mcp/tools/{search-library,get-book,get-series,list-series,list-library-facets,list-pending-fixes,get-validation-report,list-reading-progress,get-book-cover,list-book-requests}.ts`, `app/server/mcp/tools/book-summary.ts` (shared selection + formatter)
- Create: `app/server/mcp/server.test.ts`, `app/server/mcp/test-support.ts` (`connectMcpClient(app, token): Promise<{ client: Client; close }>` using `StreamableHTTPClientTransport` with the bearer header against `app.listen(0)`)
- Modify: `app/server/mcp/index.ts` (replace the 501 placeholder: per request, `viewerFromAuthInfo` → 401 if null; `isSetupComplete` false → every tool returns `SETUP_REQUIRED_MESSAGE` as `isError`; `touchGrant`; build server; `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`; `connect`; `handleRequest(req, res, req.body)`; close both in `res.on('close')`)

**Interfaces:**
- Produces: `type ToolDeps = { context: Context; viewer: Viewer; scopes: string[]; prisma; config: AppConfig; replaceStaging; thumbnails; editionsRoot: string; setupComplete: boolean }`; `buildMcpServer(deps: ToolDeps): McpServer` (name `bookplate`, version `APP_VERSION`); `registerReadTools(server, deps)`; in `execute.ts`: `class ToolError extends Error`, `executeDocument<T>(context, source: string, variables?): Promise<T>` (throws `ToolError` with the first GraphQL error message), `ok(text: string, structured: Record<string, unknown>): CallToolResult`, `fail(message: string): CallToolResult` (`isError: true`), `requireScope(deps, 'library:write')` throwing `ToolError('This connection is read only')`, `decodeBookId(deps, id): string | null` (global id → bookId when its userId is the viewer's), `NOT_FOUND_BOOK = 'No book with that id in your library'`. Tool names and arguments exactly as the spec's Read table; `first` clamped to 50 (`search_library`, `list_reading_progress`, `list_book_requests`) and 100 (`get_validation_report`); every tool declares `outputSchema` and `annotations: { readOnlyHint: true }`.

- [ ] **Step 1: Write `server.test.ts`**: seed alice with two books (one in a series, one with a pending fix and a validation row via `seedEditableBook`) and bob with one; mint alice a token via Task 3; `tools/list` returns exactly the ten read tool names (write tools are added in later tasks — assert the read names are a subset once Task 11 lands); `search_library({ query })` finds alice's book and never bob's; `get_book(alice id)` returns title, series, validation summary and the pending-fix proposal with `key`; `get_book(bob id)` and `get_book('garbage')` → `isError` with `NOT_FOUND_BOOK`; `get_book_cover` returns an `image` block when a thumbnail is seeded; a forced-password viewer gets `SETUP_REQUIRED_MESSAGE`; a deleted user's token → transport error 401.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run lint -w app/server` clean.
- [ ] **Step 5: Commit** `feat(mcp): stateless MCP server with library read tools`.

### Task 11: Write tools

**Files:**
- Create: `app/server/mcp/tools/{update-book-metadata,validate-book,resolve-metadata-fixes,regenerate-chapters,delete-book,request-book}.ts`; `registerWriteTools(server, deps)` in `server.ts`
- Test: extend `app/server/mcp/server.test.ts`

**Interfaces:**
- Consumes Task 10's `execute.ts`. Each tool: `requireScope('library:write')`, GraphQL mutation, union handling — a `UserError` member becomes `fail(`${__typename}: ${message}`)` (for `EpubValidationError` append the first five messages; for `InvalidInputError` append the issues), `null` becomes `fail(NOT_FOUND_BOOK)`. `update_book_metadata` args mirror `BookUpdateMetadataInput` minus `stagedCoverId`; `resolve_metadata_fixes` args `{ bookId, action: 'ACCEPT'|'DISMISS'|'UNDO'|'CLEAR', fixes?: {field,kind,from}[] }`; `delete_book` annotated `{ destructiveHint: true, readOnlyHint: false }`; `request_book` `{ title, author, note? }`.

- [ ] **Step 1: Extend the test**: `update_book_metadata({ bookId, title: 'New' })` → structured `book.title === 'New'` and the DB row changed (id may rotate — assert via `resolveBookId`); `validate_book` with the validator mocked invalid → `validation.valid === false`; `resolve_metadata_fixes ACCEPT` clears the proposal; `delete_book` removes the row; `request_book` creates a `BookRequest`; a `library:read`-only token calling `update_book_metadata` → `isError` "This connection is read only"; `tools/list` now has the sixteen names.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; lint clean.
- [ ] **Step 5: Commit** `feat(mcp): metadata, validation, fix-resolution, delete and request tools`.

### Task 12: Upload and replace tools

**Files:**
- Create: `app/server/mcp/tools/{upload-book,stage-replacement,replace-book-file}.ts`, `app/server/mcp/tools/bytes-input.ts` (`resolveBytes(args: { url?: string; contentBase64?: string; filename?: string }): Promise<{ bytes: Buffer; filename: string }>` — exactly one of `url`/`contentBase64` required, else `ToolError`; base64 decoded with a 6 MiB decoded cap; `FetchEpubError` → `ToolError(code-specific message)`)
- Test: extend `app/server/mcp/server.test.ts`

**Interfaces:**
- `upload_book` writes the bytes to `${getStagingDir(config.booksDir)}/mcp-<uuid>.epub` and calls `importEpub` (Task 8); maps `invalid` → `fail` with counts and first five messages, `duplicate` → `fail('A book with the same fingerprint is already in the library.')`, `imported` → `ok` with the book summary from `get_book`'s document plus `applied`/`proposals`. `stage_replacement({ bookId, url?, contentBase64?, filename? })` → `replaceStaging.stage(bytes, viewer.userId, filename, 'epub')` then `bookAnalyzeReplace` → `ok` with `stagedUploadId`, `valid`, `messages` (first 20), `autoFixes`, `proposals` each with `key = field:kind:from`. `replace_book_file({ bookId, stagedUploadId, acceptedFixKeys })` → `bookReplace`.

- [ ] **Step 1: Extend the test**: `upload_book({ contentBase64: fixtureEpub('Uploaded').toString('base64'), filename: 'u.epub' })` → a new book titled `Uploaded`; same again → duplicate error; `upload_book({ url })` with `fetchEpub` mocked (vi.mock `../fetch-epub`) → imported; `stage_replacement` + `replace_book_file` on an editable book → the book's `documentId` changed; `url` and `contentBase64` together → `isError`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test -w app/server` → PASS; lint clean.
- [ ] **Step 5: Commit** `feat(mcp): upload, stage-replacement and replace tools`.

### Task 13: Settings card — connected assistants

**Files:**
- Create: `app/client/src/graphql/mcp.ts` (`McpConnectionFragment on McpConnection { id clientName clientUri logoUri scopes createdAt lastUsedAt }`, `McpConnectionsFragment on Viewer { mcpEnabled mcpUrl mcpConnections { ...McpConnectionFragment } }`, `ViewerRevokeMcpConnectionDocument`, `McpClientDocument(query McpClient($clientId: String!) { mcpClient(clientId: $clientId) { clientId clientName clientUri } })`, `McpAuthorizeDocument(mutation McpAuthorize($input: McpAuthorizeInput!) { mcpAuthorize(input: $input) { __typename ... on McpAuthorizePayload { redirectUrl } ... on InvalidInputError { message } } })`)
- Create: `app/client/src/component/mcp-connections/{index.tsx,style.ts,index.test.tsx}`
- Modify: `app/client/src/component/index.ts`, `app/client/src/page/settings/index.tsx` (`UserPageDocument` adds `...McpConnectionsFragment` on `viewer`; mount `<McpConnections viewer={data?.viewer} />` after `ConnectionUrls`), `app/client/src/page/settings/index.test.tsx` (barrel mock gains `McpConnections`)
- Run `npm run codegen -w app/client` after adding documents.

**Interfaces:**
- `McpConnections({ viewer }: { viewer: FragmentType<typeof McpConnectionsFragment> | undefined })`. Card title `AI assistants`. Copy: lead "Connect Claude or another MCP assistant to search, fix and add books in your library."; when `mcpEnabled` is false, hint "Set `public_url` to an https address in the add-on options to enable this." and nothing else; otherwise the URL pill (reuse `ConnectionUrls`' `UrlRow` by exporting it from that module) with `mcpUrl`, then the list or the empty state "No assistants connected yet."; each row: name (an `<a>` to `clientUri` when present, `rel="noopener noreferrer"`), meta line `Connected <toLocaleDateString()> · <Last used <date> | Never used>`, a `Tag` reading `Read only` or `Read & write` (`scopes.includes('library:write')`), a link-style danger `Button` "Disconnect" with `ariaLabel` `Disconnect <name>` opening `ConfirmModal` (title `Disconnect <name>?`, body "It will lose access immediately. You can connect it again from the assistant.", confirm `Disconnect`, danger). Confirm → mutation → `client.refetchQueries({ include: [UserPageDocument] })`; failure → toast "Could not disconnect that assistant".

- [ ] **Step 1: Write `index.test.tsx`** with `renderWithApollo` + `makeFragmentData`: disabled hint; empty state; two rows with tags and dates; clicking Disconnect opens the modal, confirming fires the mutation mock with the row's id and the row disappears after a refetch mock; `SettingsPage` test mounts `McpConnections` in the reader branch only.
- [ ] **Step 2: Run** `npx vitest run component/mcp-connections page/settings -w app/client` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run lint -w app/client` clean (includes `codegen:check`).
- [ ] **Step 5: Commit** `feat(client): AI assistants card with disconnect`.

### Task 14: Consent page

**Files:**
- Create: `app/client/src/page/connect/{index.tsx,style.ts,index.test.tsx}`
- Modify: `app/client/src/page/index.ts`, `app/client/src/router/path-internal.ts` + `path.ts` (`connect = () => '/connect'`), `app/client/src/router/component.tsx` (inside `ProtectedRoute`, outside `NavLayout`, next to `setEmail`), `app/client/vite.config.ts` (proxy `/mcp` and `/.well-known`)

**Interfaces:**
- `ConnectPage`: reads `client_id`, `redirect_uri`, `code_challenge`, `state`, `scope`, `resource` from `useSearchParams`; missing `client_id`/`redirect_uri`/`code_challenge` → card "This connection link is invalid." ; `useIsAdmin()` true → card "The admin account has no library to connect. Sign in as a reader."; otherwise `useQuery(McpClientDocument)`; null client → invalid card; else `Card` title `Connect <clientName>?`, lead "<clientName> is asking to use your Bookplate library.", a `Switch` `Read only` (`name="read-only"`, `layout="horizontal"`), bullets: always "Search your library and read book and series details", plus when write "Edit metadata, run validation, upload and replace books, and act on recommendations"; buttons `Deny` (default) and `Approve` (primary, `loading` while pending). Both call `McpAuthorizeDocument` with `approve` set accordingly and `readOnly` from the switch; on `McpAuthorizePayload` call `window.location.assign(redirectUrl)`; on `InvalidInputError` toast its message.

- [ ] **Step 1: Write `index.test.tsx`**: invalid params card; admin card; renders client name from the query mock; toggling Read only removes the write bullet; Approve sends `{ approve: true, readOnly: false, clientId, redirectUri, codeChallenge, state, scope, resource }` and calls a spied `window.location.assign` with the mock's `redirectUrl`; Deny sends `approve: false`; `InvalidInputError` shows a toast and does not navigate.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (style copied from `page/set-email/style.ts`). **Step 4: Run** `npm test -w app/client` → PASS; lint clean.
- [ ] **Step 5: Commit** `feat(client): MCP consent page`.

### Task 15: Docs and final verification

**Files:**
- Modify: `README.md` (`public_url` row and `PUBLIC_URL` row: "…and enables the MCP server for AI assistants (must be https)"; new `### Connect an AI assistant (MCP)` under Usage: set `public_url`, add `<public_url>/mcp` as a custom connector / `claude mcp add --transport http bookplate <public_url>/mcp`, approve in the browser, choose Read only if wanted, disconnect from Settings → AI assistants; list the tool names in one sentence), `app/server/README.md` if it lists routes.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `npm run lint && npm test` at the repo root → all green; `npm run build -w app/server` compiles.
- [ ] **Step 3: Manual smoke** with `PUBLIC_URL=http://localhost:3000 npm run dev` and `npx @modelcontextprotocol/inspector` (or the SDK client script in `mcp/test-support.ts`): register → consent in the browser → tools/list. Record the result in the final report; if the browser step cannot be driven, say so.
- [ ] **Step 4: Commit** `docs: connecting an AI assistant over MCP`.
