# Editing a book request — design

**Started:** 2026-11-15 · **Path:** brainstorming skill (small change)

## Intent

A reader who mistyped a title or author on a book request can correct it in
place instead of withdrawing the request and submitting a new one. The same
correction is available through the MCP server.

## Goals

- A reader edits the title, author or note of their own **pending** request,
  from the web UI and from a new MCP tool.
- The admin's queue shows the corrected values the next time it is read.

## Non-goals

- Editing a fulfilled or declined request. Once answered, the wording is
  history; the reader files a new request if they still want the book.
- An admin editing a reader's request. The server allows it (owner or admin,
  the same rule `bookRequestDelete` uses) but no admin UI offers it.
- A new notification event. The admin's list always shows current values, and
  a corrected name is not news worth a second email or push.

## Anti-goals

- An edit that quietly creates a duplicate of another open request. The
  duplicate check on create must hold on update too.
- Editing that changes the request's id or its position in the list.

## Constraints (from the codebase)

- Writes live in `services/book-request.ts`; the resolver parses input and
  maps outcomes onto a union. Policy failures are returned, not thrown.
- `dedupeKey` is derived from normalized title+author and must be recomputed
  when either changes. Only `pending` rows collide.
- The row's global id carries the owner, so the owner-or-admin check is done
  on the decoded id (`isOwnerOrAdmin`), as `bookRequestDelete` does.
- MCP write tools run a GraphQL mutation through `executeDocument` under
  `guarded(deps, { write: true })` and unwrap the union with `unwrapPayload`.

## Approaches considered (UI)

| | Shape | Trade-off |
| --- | --- | --- |
| **A (chosen)** | "Edit" on the pending card swaps the body for title/author/note fields with Save and Cancel, mirroring `DeviceRow` → `DeviceForm`. | Small edit-mode form to write; the reader fixes the typo where they see it; follows the house pattern. |
| B | "Edit" opens a `ConfirmModal` with the three fields, like the Decline prompt. | Cramped at phone width; nothing else here edits in a dialog. |
| C | "Edit" loads the row into the "New request" form at the top; the button reads Save. | Least new UI, but the row may be far below the form, and it is easy to submit as a new request by mistake. |

## Design

### Service — `updateBookRequest(prisma, { userId, id, title?, author?, note? })`

One transaction:

1. Load the row. Missing → `{ kind: 'missing' }`. Not `pending` →
   `{ kind: 'notPending', status }`.
2. Merge the supplied fields over the stored ones (trimmed). Recompute
   `dedupeKey`. If it changed, look for another pending row of the same user
   with that key, excluding this id → `{ kind: 'duplicate', existingId }`.
3. Update title, author, note, dedupeKey → `{ kind: 'updated' }`.

No notification enqueue (see non-goals). `createdAt` is untouched, so the
cursor and list order are stable.

### GraphQL — `Mutation.bookRequestUpdate(id: ID!, input: BookRequestUpdateInput!)`

- `BookRequestUpdateInput { title: String, author: String, note: String }`,
  all optional. An omitted field is unchanged; a supplied one is validated
  with the same zod rules as create (trimmed, title/author non-empty, max
  lengths).
- Result union: `BookRequestUpdatePayload { bookRequest }` |
  `InvalidInputError` | `DuplicateBookRequestError` |
  `BookRequestNotPendingError`. `null` for a malformed id, a missing row, or
  a caller who is neither owner nor admin, exactly as delete answers.
- Owner-or-admin via `isOwnerOrAdmin` on the decoded compound id. The
  config-based admin can call it (it is an admin); a reader can only reach
  their own rows.
- Payload re-reads the row with `t.prismaField`, matching the other payloads.

### Client

- `BookRequestUpdateDocument` in `graphql/book-request.ts`, selecting
  `bookRequest { id ...BookRequestRowFragment }` so Apollo normalization
  updates the card in place; no refetch and no queue invalidation, since
  membership and order do not change.
- `BookRequestRow`, reader view (`canResolve === false`), `status === PENDING`:
  an "Edit" button beside Withdraw. Editing swaps the card body for a form
  (title, author, note) with Save and Cancel. Client-side validation matches
  the create form. A union error (duplicate, not pending) or a thrown error
  renders inline in the form; success returns to the read view.
- **Builder's call, my default:** extract the create form's fields into a
  shared `component/book-request-form` used by both the create card and the
  row's edit mode, mirroring `DeviceForm`, so the two cannot drift. If that
  refactor turns out larger than the feature, a row-local edit form is fine.
- Admin view unchanged.

### MCP — `update_book_request`

- Input: `id` (the global id `list_book_requests` returns), plus optional
  `title`, `author`, `note` with the same bounds as `request_book`.
- Runs `bookRequestUpdate`, unwraps with `unwrapPayload` (error fragments for
  `InvalidInputError`, `DuplicateBookRequestError`, and a new
  `BookRequestNotPendingError` entry in `userErrorFields`), returns the
  updated request via `toBookRequest` / `describeBookRequest`.
- Annotations: not read-only, not destructive, idempotent.
- Registered in `mcp/server.ts` next to `request_book`.

### Tests

Service and resolver tests alongside the existing create/decline/delete tests
(happy path, missing, not pending, duplicate, owner vs. other reader vs.
admin, partial input leaves other fields alone). Row and content component
tests for the edit mode. MCP server test for the new tool, following the
`request_book` case.

## Left to the builder

- Exact copy of the Edit/Save/Cancel buttons and the inline error text.
- Whether the shared form extraction happens (see above).
