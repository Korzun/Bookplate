# Book Identity via Relay ID — Design

Status: implemented, 2026-08-02 (commits `6c290375..b8fb8976`). Suite 1698/1698 green, lint
clean (oxlint, oxfmt, tsc, `graphql:schema:check`). Final SDL diff vs `1b5056b9` gated exact at
Task 4's review: 2 output removals (`Book.bookId`, `BookDeletePayload.deletedBookId`) + 10
input reshapes (`bookId`[`+userId`] → `id: ID!` across all 10 book mutations) + 5 traced
`InvalidInputError` union-member drops (`BookClearEditionsResult`, `BookDeleteResult`,
`BookRegenChaptersResult`, `BookResolvePendingFixResult`, `BookValidateResult`) — nothing else.
Depends on: `2026-07-30-graphql-server-design.md` (spec 1, complete at `1b5056b9`)
Timing: before spec 2 (Houdini client) — no GraphQL client exists yet, so the schema
break is free. After spec 2 starts, this change becomes a coordinated migration; do it now.

## Goal

The GraphQL layer's only book identifier is the Relay global ID. The raw content hash
(`bookId`) disappears from the schema surface — outputs and inputs both. Stores and REST
keep operating on raw ids; the resolver boundary decodes.

The Book global ID already encodes the compound key — `base64(Book:JSON.stringify([userId,
bookId]))` — which is what makes the input-side collapse possible: one `id: ID!` carries
both the target book and the owner it belongs to, exactly as `Query.node` lookups already
work.

## Output changes (2 removals)

1. `Book.bookId: String!` — removed (`schema/book/model.ts:42`). Clients use `id`.
2. `BookDeletePayload.deletedBookId: String!` — removed. `deletedId: ID!` remains the sole
   eviction key.

**Supersession note:** spec 1's Task 2 adjudication ("deletes of Node-backed entities carry
BOTH `deletedId: ID!` and the raw-key field for REST parity") is superseded for Book. The
raw field served hypothetical REST-parity consumers; the only consumer of this schema is
the phase-2 Houdini client, which evicts by `deletedId`. Non-Node deletes
(`deletedDocument`, `deletedDeviceId`) are untouched — they have no global ID to return.

No other output field exposes the raw hash: `coverUrl`/`downloadUrl` are server-computed
strings (schema-cleanup pass), and `ScanStatus` carries no book ids.

## Input changes (10 mutations)

Every book mutation input replaces `bookId: String!` + `userId: ID` (required on some,
optional on others — an asymmetry this change erases) with a single **`id: ID!`**, a Pothos
relay `globalID` argument scoped to `Book`:

`bookUpdateMetadata`, `bookDelete`, `bookValidate`, `bookRegenChapters`,
`bookAnalyzeReplace`, `bookReplace`, `bookLinkDocument`, `bookUnlinkDocument`,
`bookClearEditions`, `bookResolvePendingFix`.

Resolver boundary: the decoded `{typename, id}` yields `JSON.stringify([userId, bookId])`,
parsed by the same compound-key helper `node-scope.ts` uses. The resolver then proceeds
with `{userId, bookId}` exactly as it did with the two args.

Rejection shapes (established in spec 1, unchanged):
- Malformed global ID → top-level error from the relay arg mapper, outside the resolver
  (Task 6 probe: identical shape for union and non-union fields).
- Wrong-type global ID (e.g. a Series id) → rejected at the arg layer, top-level error.
- Well-formed ID naming a non-existent book → the mutation's existing not-found shape
  (nullable payload / precondition member), unchanged.

## Auth (semantics unchanged — user ruling: keep FORBIDDEN)

- `ownerOf` runs on the **decoded** userId. Bob passing alice's book ID → FORBIDDEN.
  Admin passing alice's book ID → allowed (admin-or-owner, as today).
- Admin targeting is now expressed by the ID itself; there is no separate targeting arg.
- The Owner-minting single door is untouched: the decoded userId flows through the same
  `isOwnerOrAdmin`/`ownerOf` path the node reads use.
- Test shapes preserved: non-admin-on-SELF discrimination (bob's own book ID → allowed),
  cross-tenant (bob → alice's ID: FORBIDDEN AND alice's data unchanged), admin-traversal
  asserting contents. Only ID construction changes (`encodeGlobalID`, already used in
  delete tests).
- `authorizeOnSubscribe` and the subscription's decoded-`libraryId` `ownerOf` are the
  existing precedent for scope-on-decoded-arg; mutations join it.

## Deliberately untouched

- `documentId` args and fields (kosync document ids — not Nodes).
- `stagedUploadId`/`stagedCoverId` (opaque `String` service tokens by spec-1 adjudication).
- `acceptedFixKeys` (fix-proposal keys).
- All Device mutations and `deletedDeviceId` (Device is `prismaObject`, not a Node; making
  it a Node is separate, unrequested work).
- `Progress` mutations (`document`-keyed, not a Node).
- REST routes: byte-identical. Stores: unchanged signatures (raw ids).
- `Library`/`User` global-ID args on non-book mutations: already Relay IDs, unchanged.

## Testing

- SDL diff is the review artifact: exactly the 2 output removals + 10 input reshapes +
  the honest union-member drops, nothing else. `graphql:schema:check` gates as always.
  *(Discovered consequence, follows from the arg-layer-rejection ruling: mutations whose
  ONLY zod-validated input was `bookId` lose their reachable path to `InvalidInputError`,
  and spec 1's no-unreachable-members rule then requires dropping it from those result
  unions — expected: `bookValidate`, `bookDelete`, `bookClearEditions`,
  `bookRegenChapters`, `bookResolvePendingFix`; each drop must be TRACED in code, not
  assumed — a mutation that still zod-validates another field keeps the member. Unions
  left with one member stay unions — spec 1's single-member-union precedent.)*
- Every touched mutation test keeps its property-protecting shape; seen-to-fail
  re-demonstrated where a test's discriminating power could have been weakened by the ID
  change (specifically: cross-tenant tests must fail against a resolver that ignores the
  decoded userId and substitutes the viewer's — the `??`-fallback bug class from spec 1's
  ledger, which admin-traversal cannot see).
- One new test per arg-layer rejection class (malformed, wrong-type) on a representative
  mutation — not all ten; the arg mapper is shared machinery.
- Suite green from `app/server`, lint from repo root, before and after.

## Docs

- Spec 1's §Mutations table and its phase-2 handoff section updated in place (that section
  was titled "Phase 2 (Houdini) inputs" at the time; renamed to "Phase 2 (Apollo Client)
  inputs" on 2026-08-02 when the client target changed):
  Book keys on `id`; no raw hash anywhere in the schema; `deletedId` sole eviction key;
  the Task 2 supersession noted where the carry-both rule is stated.
- The input-shape examples in the handoff (staged-upload flow) updated to `id: ID!`.

## Delivery

One plan, small task count (the 10 mutations are mechanical repeats of one reshape;
the model-field removals are trivial; docs close it out). Executed with
subagent-driven-development like spec 1's plans.
