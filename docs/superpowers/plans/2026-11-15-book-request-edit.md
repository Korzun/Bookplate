# Book Request Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader corrects the title, author or note of a pending book request in place, from the web UI and through a new MCP tool, instead of withdrawing and resubmitting.

**Architecture:** A new `updateBookRequest` service function (one transaction: load, pending check, dedupe recompute, write) behind a new `bookRequestUpdate` GraphQL mutation with a partial input and a union result. The client adds an update document, extracts the request form fields into a shared `BookRequestForm` used by both the create card and a new edit mode on the reader's pending row. The MCP server gains `update_book_request`, which runs the same mutation.

**Tech Stack:** Node 24, TypeScript, Prisma (SQLite), Pothos GraphQL, zod, MCP SDK, React 19, Apollo Client 4, graphql-codegen client preset, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-15-book-request-edit-design.md`

## Global Constraints

- Only `pending` requests are editable; a resolved one answers `BookRequestNotPendingError`.
- Validation rules are the create rules: trimmed, title and author non-empty, title/author max 500, note max 2000.
- Changing title or author recomputes `dedupeKey`; a collision with another OPEN request of the same reader is `DuplicateBookRequestError`. Only `pending` rows collide.
- Owner or admin may update (same rule as `bookRequestDelete`); the UI offers Edit only on the reader's own view (`canResolve === false`).
- No notification is enqueued on update.
- `createdAt`, `id`, `status` are untouched, so list order and cursors are stable.
- An omitted or `null` input field means "unchanged". An empty string for `note` clears it.
- Tests: `cd app/server && npm test` and `cd app/client && npm test`. Lint from the repo root: `npm run lint` (runs both workspaces, schema check and codegen check).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. Editing only the case or spacing of title/author (dedupe key unchanged) must succeed, not be refused as a duplicate of itself. → Task 1 test "does not collide with itself".
2. A `null` field in `BookRequestUpdateInput` must leave that field alone, not clear it. → Task 2 test "treats a null field as unchanged".
3. An input with no fields at all is a no-op that returns the row, not an error. → Task 2 test "accepts an empty input as a no-op".
4. A whitespace-only author must be refused on both ends with the same copy as create. → Task 4 form test "will not submit a whitespace-only author"; Task 2 covers the server side ("refuses an empty author").
5. The request gets resolved by the admin while the reader has the edit form open: Save shows the server's message inline and keeps the form open rather than silently closing. → Task 5 test "keeps the form open and shows the message when the request is no longer pending".

---

### Task 1: Service `updateBookRequest`

**Files:**
- Modify: `app/server/services/book-request.ts` (append after `declineBookRequest`)
- Test: `app/server/services/book-request.test.ts`

**Interfaces:**
- Consumes: `dedupeKey(title, author)`, `BookRequestStatus`, `enqueueNotification` (must NOT be called).
- Produces:
  ```ts
  export type UpdateBookRequestOutcome =
    | { kind: 'updated' }
    | { kind: 'missing' }
    | { kind: 'notPending'; status: BookRequestStatus }
    | { kind: 'duplicate'; existingId: string };

  export async function updateBookRequest(
    prisma: PrismaClient,
    args: { userId: string; id: string; title?: string; author?: string; note?: string }
  ): Promise<UpdateBookRequestOutcome>;
  ```

- [ ] **Step 1: Write the failing tests**

Add `updateBookRequest` to the import list, then a new `describe` after `deleteBookRequest`'s:

```ts
describe('updateBookRequest', () => {
  const seed = async () => {
    const created = await createBookRequest(prisma, input({ author: 'Frank Hebert' }));
    if (created.kind !== 'created') throw new Error('setup failed');
    return created.id;
  };

  it('rewrites the supplied fields, recomputes the dedupe key, and leaves the rest', async () => {
    const id = await seed();
    const outcome = await updateBookRequest(prisma, { userId: ALICE, id, author: 'Frank Herbert' });
    expect(outcome).toEqual({ kind: 'updated' });
    const row = await prisma.bookRequest.findUniqueOrThrow({ where: { userId_id: { userId: ALICE, id } } });
    expect(row).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      note: '',
      status: 'pending',
      dedupeKey: 'dune\0frank herbert',
    });
  });

  it('trims the supplied strings', async () => {
    const id = await seed();
    await updateBookRequest(prisma, { userId: ALICE, id, title: '  Dune Messiah ', note: ' the sequel ' });
    const row = await prisma.bookRequest.findUniqueOrThrow({ where: { userId_id: { userId: ALICE, id } } });
    expect(row.title).toBe('Dune Messiah');
    expect(row.note).toBe('the sequel');
  });

  it('does not collide with itself', async () => {
    const id = await seed();
    const outcome = await updateBookRequest(prisma, { userId: ALICE, id, author: 'FRANK  HEBERT' });
    expect(outcome).toEqual({ kind: 'updated' });
  });

  it('refuses an edit that duplicates another open request', async () => {
    const id = await seed();
    const other = await createBookRequest(prisma, input({ title: 'Dune Messiah' }));
    if (other.kind !== 'created') throw new Error('setup failed');
    const outcome = await updateBookRequest(prisma, { userId: ALICE, id, title: 'dune messiah', author: 'Frank Herbert' });
    expect(outcome).toEqual({ kind: 'duplicate', existingId: other.id });
    const row = await prisma.bookRequest.findUniqueOrThrow({ where: { userId_id: { userId: ALICE, id } } });
    expect(row.title).toBe('Dune');
  });

  it('ignores resolved requests when checking for duplicates', async () => {
    const id = await seed();
    const other = await createBookRequest(prisma, input({ title: 'Dune Messiah' }));
    if (other.kind !== 'created') throw new Error('setup failed');
    await prisma.bookRequest.update({ where: { userId_id: { userId: ALICE, id: other.id } }, data: { status: 'declined' } });
    const outcome = await updateBookRequest(prisma, { userId: ALICE, id, title: 'Dune Messiah', author: 'Frank Herbert' });
    expect(outcome).toEqual({ kind: 'updated' });
  });

  it('reports a missing request', async () => {
    expect(await updateBookRequest(prisma, { userId: ALICE, id: 'gone', title: 'x' })).toEqual({ kind: 'missing' });
  });

  it('refuses to edit a resolved request', async () => {
    const id = await seed();
    await prisma.bookRequest.update({ where: { userId_id: { userId: ALICE, id } }, data: { status: 'fulfilled' } });
    expect(await updateBookRequest(prisma, { userId: ALICE, id, title: 'x' })).toEqual({ kind: 'notPending', status: 'fulfilled' });
  });

  it('leaves createdAt and id alone', async () => {
    const id = await seed();
    const before = await prisma.bookRequest.findUniqueOrThrow({ where: { userId_id: { userId: ALICE, id } } });
    await updateBookRequest(prisma, { userId: ALICE, id, title: 'Dune Messiah' });
    const after = await prisma.bookRequest.findUniqueOrThrow({ where: { userId_id: { userId: ALICE, id } } });
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.id).toBe(before.id);
  });

  it('enqueues no notification', async () => {
    const id = await seed();
    vi.mocked(enqueueNotification).mockClear();
    await updateBookRequest(prisma, { userId: ALICE, id, author: 'Frank Herbert' });
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run services/book-request.test.ts -t updateBookRequest`
Expected: FAIL, `updateBookRequest` is not exported.

- [ ] **Step 3: Implement `updateBookRequest` in `app/server/services/book-request.ts`**

One `prisma.$transaction`: `findUnique` the row (`status`, `title`, `author`, `note`); missing → `missing`; not pending → `notPending`. Merge `args.title ?? row.title` etc, trimmed. Compute `key = dedupeKey(title, author)`. If `key !== row.dedupeKey`, `findFirst` where `{ userId, dedupeKey: key, status: 'pending', NOT: { id } }` → `duplicate`. `update` with `{ title, author, note, dedupeKey: key }`. Doc comment: no notification, and why (the admin's queue reads current values).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run services/book-request.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-request.ts app/server/services/book-request.test.ts
git commit -m "feat(server): updateBookRequest service for editing a pending request"
```

---

### Task 2: GraphQL `Mutation.bookRequestUpdate`

**Files:**
- Create: `app/server/graphql/schema/book-request/mutation/update.ts`
- Modify: `app/server/graphql/schema/book-request/index.ts` (add `import './mutation/update';`)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/book-request/mutation/update.test.ts`

**Interfaces:**
- Consumes: `updateBookRequest` (Task 1), `decodeCompoundGlobalId`, `isOwnerOrAdmin` (`../../node-scope`), `invalidInputError`, `duplicateBookRequestError`, `bookRequestNotPendingError` and their `model`s, `model as bookRequestModel` (`../model`).
- Produces (SDL):
  ```graphql
  input BookRequestUpdateInput { title: String, author: String, note: String }
  type BookRequestUpdatePayload { bookRequest: BookRequest! }
  union BookRequestUpdateResult = BookRequestUpdatePayload | InvalidInputError | DuplicateBookRequestError | BookRequestNotPendingError
  bookRequestUpdate(id: ID!, input: BookRequestUpdateInput!): BookRequestUpdateResult   # nullable
  ```

- [ ] **Step 1: Write the failing tests**

`update.test.ts`, same harness and `seedRequest` helper as `delete.test.ts` (copy it; seed author `'Frank Hebert'`, dedupeKey `'dune\0frank hebert'`):

```ts
const MUTATION = `
  mutation Update($id: ID!, $input: BookRequestUpdateInput!) {
    bookRequestUpdate(id: $id, input: $input) {
      __typename
      ... on BookRequestUpdatePayload { bookRequest { title author note status } }
      ... on InvalidInputError { message issues { path message } }
      ... on DuplicateBookRequestError { message existingRequestId }
      ... on BookRequestNotPendingError { message status }
    }
  }
`;

describe('Mutation.bookRequestUpdate', () => {
  it('lets the owner correct the author and leaves the other fields alone', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { author: 'Frank Herbert' } },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestUpdate).toEqual({
      __typename: 'BookRequestUpdatePayload',
      bookRequest: { title: 'Dune', author: 'Frank Herbert', note: '', status: 'PENDING' },
    });
  });

  it('lets an admin edit a request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { id: gid, input: { note: 'hardcover please' } },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({ __typename: 'BookRequestUpdatePayload' });
  });

  it('refuses another reader with null, leaving the row untouched', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { id: gid, input: { author: 'Bob' } },
    });
    expect(result.data?.bookRequestUpdate ?? null).toBeNull();
    const row = await harness.prisma.bookRequest.findFirstOrThrow();
    expect(row.author).toBe('Frank Hebert');
  });

  it('returns null for a request that is not there', async () => {
    const missing = encodeGlobalID('BookRequest', JSON.stringify([harness.aliceOwner.userId, 'gone']));
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: missing, input: { title: 'x' } },
    });
    expect(result.data?.bookRequestUpdate ?? null).toBeNull();
  });

  it('reports an already-resolved request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.prisma.bookRequest.updateMany({ data: { status: 'declined' } });
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: 'x' } },
    });
    expect(result.data?.bookRequestUpdate).toEqual({
      __typename: 'BookRequestNotPendingError',
      message: 'This request has already been declined.',
      status: 'DECLINED',
    });
  });

  it('reports a duplicate of another open request', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    await harness.prisma.bookRequest.create({
      data: { userId: harness.aliceOwner.userId, id: 'req-2', title: 'Dune Messiah', author: 'Frank Herbert', dedupeKey: 'dune messiah\0frank herbert', createdAt: 2_000 },
    });
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: 'dune messiah', author: 'frank herbert' } },
    });
    expect(result.data?.bookRequestUpdate).toEqual({
      __typename: 'DuplicateBookRequestError',
      message: 'You have already requested this book.',
      existingRequestId: 'req-2',
    });
  });

  it('refuses an empty author', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { author: '   ' } },
    });
    const payload = result.data?.bookRequestUpdate as { __typename: string; issues: { path: string[] }[] };
    expect(payload.__typename).toBe('InvalidInputError');
    expect(payload.issues.map((i) => i.path)).toContainEqual(['author']);
  });

  it('refuses a title over 500 characters', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: 'x'.repeat(501) } },
    });
    expect((result.data?.bookRequestUpdate as { __typename: string }).__typename).toBe('InvalidInputError');
  });

  it('treats a null field as unchanged', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: { title: null, author: 'Frank Herbert' } },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({
      bookRequest: { title: 'Dune', author: 'Frank Herbert' },
    });
  });

  it('accepts an empty input as a no-op', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { id: gid, input: {} },
    });
    expect(result.data?.bookRequestUpdate).toMatchObject({
      __typename: 'BookRequestUpdatePayload',
      bookRequest: { title: 'Dune', author: 'Frank Hebert' },
    });
  });

  it('refuses an unauthenticated caller', async () => {
    const gid = await seedRequest(harness.aliceOwner.userId);
    const result = await harness.execute(MUTATION, {
      viewer: null,
      variables: { id: gid, input: { title: 'x' } },
    });
    expect(result.errors).toBeDefined();
  });
});
```

(Check `create.test.ts`'s "refuses an unauthenticated caller" for the exact `viewer` value the harness uses for anonymous, and copy it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run graphql/schema/book-request/mutation/update.test.ts`
Expected: FAIL, unknown field `bookRequestUpdate`.

- [ ] **Step 3: Implement `update.ts`**

Mirror `create.ts` for the zod schema and payload, `delete.ts` for id decoding and `isOwnerOrAdmin`. Zod: the three create rules each `.optional()`; parse `{ title: args.input.title ?? undefined, ... }` so GraphQL `null` folds to omitted. Payload shape `{ __typename: 'BookRequestUpdatePayload', userId, requestId }` with a `t.prismaField` re-read. No field-level `authScopes` (type-level authenticated; owner-or-admin decided on the decoded id, as delete does). Map outcomes: `updated` → payload, `missing` → `null`, `notPending` → `bookRequestNotPendingError(status)`, `duplicate` → `duplicateBookRequestError(existingId)`. Description: `'Corrects the title, author or note of a pending request.'`. Add `import './mutation/update';` to `book-request/index.ts`.

- [ ] **Step 4: Regenerate the SDL and run the tests**

Run: `cd app/server && npm run graphql:schema && npx vitest run graphql/schema/book-request services/book-request.test.ts graphql/schema/root-auth.test.ts`
Expected: PASS. `git diff --stat` shows `schema.generated.graphql` changed.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql/schema/book-request app/server/graphql/schema.generated.graphql
git commit -m "feat(graphql): bookRequestUpdate mutation"
```

---

### Task 3: MCP tool `update_book_request`

**Files:**
- Create: `app/server/mcp/tools/update-book-request.ts`
- Modify: `app/server/mcp/tools/mutation.ts` (add `BookRequestNotPendingError` to `ERROR_FRAGMENTS` and `status?: string` to `UserErrorMember`; render it as `  Status: <status>`)
- Modify: `app/server/mcp/server.ts` (import and call `registerUpdateBookRequest(server, deps)` after `registerRequestBook`)
- Test: `app/server/mcp/server.test.ts`

**Interfaces:**
- Consumes: `BOOK_REQUEST_FIELDS`, `bookRequestSchema`, `describeBookRequest`, `toBookRequest`, `BookRequestGql` (`./list-book-requests`); `executeDocument`, `guarded`, `ok`, `ToolError` (`./execute`); `unwrapPayload`, `userErrorFields` (`./mutation`).
- Produces: `export function registerUpdateBookRequest(server: McpServer, deps: ToolDeps): void` registering tool `update_book_request` with input `{ id: z.string(), title?: string(1..500), author?: string(1..500), note?: string(max 2000) }`, output `bookRequestSchema.shape`, annotations `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`.

- [ ] **Step 1: Write the failing tests**

In `server.test.ts`: add `'update_book_request'` to `WRITE_TOOLS`, then after the `request_book` case:

```ts
it('update_book_request corrects a pending request', async () => {
  mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
  const created = await mcp.call('request_book', { title: 'Dune', author: 'Frank Hebert' });
  const id = (created.structuredContent as { id: string }).id;

  const result = await mcp.call('update_book_request', { id, author: 'Frank Herbert' });
  expect(result.isError, textOf(result)).toBeFalsy();
  expect(result.structuredContent).toMatchObject({ id, title: 'Dune', author: 'Frank Herbert', status: 'PENDING' });
  expect(textOf(result)).toMatch(/^Updated: /);

  await mcp.call('request_book', { title: 'Dune Messiah', author: 'Frank Herbert' });
  const dup = await mcp.call('update_book_request', { id, title: 'Dune Messiah' });
  expect(dup.isError).toBe(true);
  expect(textOf(dup)).toContain('DuplicateBookRequestError');
});

it('update_book_request refuses a resolved request and an unknown id', async () => {
  mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
  const created = await mcp.call('request_book', { title: 'Dune', author: 'Frank Herbert' });
  const id = (created.structuredContent as { id: string }).id;
  await harness.prisma.bookRequest.updateMany({ data: { status: 'declined' } });

  const resolved = await mcp.call('update_book_request', { id, note: 'x' });
  expect(resolved.isError).toBe(true);
  expect(textOf(resolved)).toContain('BookRequestNotPendingError');

  const unknown = await mcp.call('update_book_request', { id: 'bm90LWEtcmVhbC1pZA==', note: 'x' });
  expect(unknown.isError).toBe(true);
  expect(textOf(unknown)).toContain('No book request');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run mcp/server.test.ts -t update_book_request`
Expected: FAIL, unknown tool (and the `WRITE_TOOLS` list test fails).

- [ ] **Step 3: Implement the tool**

`update-book-request.ts` mirrors `request-book.ts`. Document:

```graphql
mutation UpdateBookRequest($id: ID!, $input: BookRequestUpdateInput!) {
  bookRequestUpdate(id: $id, input: $input) {
    __typename
    ... on BookRequestUpdatePayload { bookRequest { ${BOOK_REQUEST_FIELDS} } }
    ${userErrorFields(['InvalidInputError', 'DuplicateBookRequestError', 'BookRequestNotPendingError'])}
  }
}
```

Description: `'Corrects the title, author or note of a pending book request you made. Omitted fields are unchanged. Use the id list_book_requests returns.'` Handler: `guarded(deps, { write: true }, ...)`; if `data.bookRequestUpdate === null` throw `new ToolError('No book request with that id, or it is not yours')` (do not reuse `NOT_FOUND_BOOK`, which names a book); else `unwrapPayload`, `toBookRequest`, `ok(`Updated: ${describeBookRequest(request)}`, request)`. In `mutation.ts` add `BookRequestNotPendingError: '... on BookRequestNotPendingError { status }'` and a `status` line in `renderUserError`. Register in `server.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run mcp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/mcp
git commit -m "feat(mcp): update_book_request tool"
```

---

### Task 4: Client `BookRequestUpdateDocument` and shared `BookRequestForm`

**Files:**
- Modify: `app/client/src/graphql/book-request.ts` (add the document)
- Create: `app/client/src/component/book-request-form/index.tsx`, `style.ts`
- Modify: `app/client/src/component/book-requests-content/index.tsx` (replace the inline form with `BookRequestForm`), `style.ts` (drop `form` if unused)
- Modify: `app/client/src/gql/*` (regenerated by codegen)
- Test: `app/client/src/component/book-request-form/index.test.tsx`; existing `book-requests-content/index.test.tsx` must keep passing unchanged.

**Interfaces:**
- Produces:
  ```ts
  export type BookRequestFormValues = { title: string; author: string; note: string };
  export type BookRequestFormProps = {
    /** When given, the form edits these values and offers Cancel; otherwise it is the create form and clears itself after a successful submit. */
    initial?: BookRequestFormValues;
    submitLabel: string;
    /** Receives TRIMMED values. Resolves to `undefined` on success, or the message to show under the fields. */
    onSubmit: (values: BookRequestFormValues) => Promise<string | undefined>;
    onCancel?: () => void;
  };
  export const BookRequestForm: (props: BookRequestFormProps) => JSX.Element;
  ```
  Field inputs keep `name="title"`, `name="author"`, `name="note"` and labels `Title`, `Author`, `Note`. Validation copy, unchanged from the current content component: `"Title is required"`, `"Author is required"`, `"Title and Author are required"`.
  ```graphql
  mutation BookRequestUpdate($id: ID!, $input: BookRequestUpdateInput!) {
    bookRequestUpdate(id: $id, input: $input) {
      __typename
      ... on BookRequestUpdatePayload { bookRequest { id ...BookRequestRowFragment } }
      ... on InvalidInputError { message issues { path message } }
      ... on DuplicateBookRequestError { message existingRequestId }
      ... on BookRequestNotPendingError { message status }
    }
  }
  ```

- [ ] **Step 1: Add `BookRequestUpdateDocument` and regenerate**

Append the document above to `graphql/book-request.ts` with a doc comment saying the full-fragment re-selection is what updates the card in place, so no refetch and no `invalidateRequestQueues` is needed (membership and order do not change). Run: `cd app/client && npm run codegen`. Expected: `src/gql/graphql.ts` gains `BookRequestUpdateMutation`, `BookRequestUpdateMutationVariables`, `BookRequestUpdateInput`.

- [ ] **Step 2: Write the failing form tests**

`book-request-form/index.test.tsx` (field lookups via `container.querySelector('input[name="title"]')` for the same reason the content test gives; `renderWithApollo` from `~/test-utils` is not needed, plain `render` from Testing Library is fine since the form runs no queries):

```ts
describe('BookRequestForm', () => {
  it('will not submit without both title and author', async () => { /* type title only, click submit → onSubmit not called, "Author is required" shown */ });
  it('will not submit a whitespace-only author', async () => { /* author "   " → "Author is required", onSubmit not called */ });
  it('submits trimmed values', async () => { /* "  Dune " / " Frank Herbert " / " note " → onSubmit called with { title: 'Dune', author: 'Frank Herbert', note: 'note' } */ });
  it('clears itself after a successful create', async () => { /* no initial; onSubmit resolves undefined → inputs read '' */ });
  it('shows the message and keeps the values when submit fails', async () => { /* onSubmit resolves 'Too many' → text shown, title still 'Dune' */ });
  it('prefills from initial, keeps the values after saving, and offers Cancel', async () => { /* initial given → author input has value; submit → values retained; click Cancel → onCancel called, onSubmit not */ });
  it('offers no Cancel without onCancel', () => { /* queryByRole('button', { name: /cancel/i }) is null */ });
});
```

Write each body with `userEvent.setup()`; `submitLabel: 'Request'` for create cases and `'Save'` for edit cases.

- [ ] **Step 3: Run the form tests to verify they fail**

Run: `cd app/client && npx vitest run src/component/book-request-form`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `BookRequestForm`**

Move the field state, `handleSubmit`'s validation and the JSX (`TextInput` ×2, `TextArea`, error line, `CardDivider`, primary submit `Button`) out of `BookRequestsContent` into the new component. Track `submitting` locally for the Button's `loading`. On `onSubmit` resolving a string, set it as `formError`; on `undefined` and no `initial`, clear the three fields. Render a `Button type="default"` labelled `Cancel` beside Save only when `onCancel` is given; both in a flex row (style `actions`). Doc comment: shared by the create card and the row's edit mode so validation cannot drift, mirroring `DeviceForm`.

- [ ] **Step 5: Switch `BookRequestsContent` to the shared form**

Replace the inline form with `<BookRequestForm submitLabel="Request" onSubmit={handleCreate} />` inside the existing `Card title="New request"`. `handleCreate` runs the mutation, unwraps, returns the error message or, after `refetchQueries`, `undefined`. Remove the now-unused `title`/`author`/`note`/`formError` state and `TextInput`/`TextArea`/`CardDivider` imports.

- [ ] **Step 6: Run the client tests and verify they pass**

Run: `cd app/client && npx vitest run src/component/book-request-form src/component/book-requests-content`
Expected: PASS, with the content suite unchanged.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/graphql/book-request.ts app/client/src/gql app/client/src/component/book-request-form app/client/src/component/book-requests-content
git commit -m "feat(client): BookRequestUpdate document and shared BookRequestForm"
```

---

### Task 5: Edit mode on the reader's pending row

**Files:**
- Modify: `app/client/src/component/book-request-row/index.tsx`
- Test: `app/client/src/component/book-request-row/index.test.tsx`

**Interfaces:**
- Consumes: `BookRequestForm` (Task 4), `BookRequestUpdateDocument`, `BookRequestUpdateMutation`/`...Variables` (Task 4), `unwrapResult` (`~/provider/apollo`), `Card`.
- Produces: no prop changes. An `Edit` button on the reader's pending row (`!canResolve && status === 'PENDING'`), in `footerRight`, `type="default"`. Editing replaces the card with `<Card><BookRequestForm initial={{ title, author, note }} submitLabel="Save" onSubmit={handleSave} onCancel={...} /></Card>`.

- [ ] **Step 1: Write the failing tests**

In `renderRow`, add `updateCallsArr: { id: string; input: unknown }[]` and a mock for `BookRequestUpdateDocument` whose `variables` matcher records them, with result `{ __typename: 'BookRequestUpdatePayload', bookRequest: { ...requestRow({ ...overrides, author: 'Frank Herbert' }), id: request.id } }`; expose `updateCalls`. Add an `updateResult?: BookRequestUpdateMutation['bookRequestUpdate']` prop so one test can substitute a `BookRequestNotPendingError`. Then:

```ts
describe('BookRequestRow — editing', () => {
  const authorInput = (c: HTMLElement) => c.querySelector('input[name="author"]') as HTMLInputElement;

  it('offers Edit to the reader while pending, and nowhere else', () => {
    renderRow({ status: 'PENDING' }, { canResolve: false });
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    cleanup();
    renderRow({ status: 'DECLINED' }, { canResolve: false });
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    cleanup();
    renderRow({ status: 'PENDING' }, { canResolve: true, libraryId: 'lib-1' });
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('prefills the form, saves the corrected author, and returns to the card', async () => {
    const { user, container, updateCalls } = renderRow({ id: 'req-1', author: 'Frank Hebert' });
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(authorInput(container)).toHaveValue('Frank Hebert');
    await user.clear(authorInput(container));
    await user.type(authorInput(container), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(updateCalls()).toHaveLength(1));
    expect(updateCalls()[0]).toEqual({ id: 'req-1', input: { title: 'Dune', author: 'Frank Herbert', note: '' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeInTheDocument();
  });

  it('cancels back to the card without saving', async () => {
    const { user, updateCalls } = renderRow();
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(updateCalls()).toHaveLength(0);
    expect(screen.getByText('Dune')).toBeInTheDocument();
  });

  it('keeps the form open and shows the message when the request is no longer pending', async () => {
    const { user } = renderRow({}, {
      updateResult: { __typename: 'BookRequestNotPendingError', message: 'This request has already been fulfilled.', status: 'FULFILLED' },
    });
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/already been fulfilled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });
});
```

Note for the implementer: the row's `request` prop is static `makeFragmentData`, so the test asserts the mutation variables and the mode switch, not the re-rendered author text. In the app, Apollo normalizes `BookRequest:<id>` from the payload and the parent list re-renders the row.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/client && npx vitest run src/component/book-request-row -t editing`
Expected: FAIL, no Edit button.

- [ ] **Step 3: Implement edit mode in `BookRequestRow`**

`const [editing, setEditing] = useState(false)`, `const [runUpdate] = useMutation(BookRequestUpdateDocument)`. `handleSave(values)`: `runUpdate({ variables: { id: row.id, input: values } })`, `unwrapResult<BookRequestUpdatePayload>(data?.bookRequestUpdate, 'BookRequestUpdatePayload')`; `missing` → `'Failed to save changes'`, `error` → `outcome.message`, `ok` → `setEditing(false)` and return `undefined`; catch → the error's message. Early return when `editing` (after all hooks, as `DeviceRow` does): `<Card><BookRequestForm initial=… submitLabel="Save" onSubmit={handleSave} onCancel={() => setEditing(false)} /></Card>`. In the reader footer, put Withdraw on the left and `<div className={styles.footerRight}><Button type="default" radius="card" onClick={() => setEditing(true)}>Edit</Button></div>` on the right, the Edit only while `PENDING`. Extend the row's doc comment with an "Edit" paragraph: reader-only, pending-only, no refetch needed and why.

- [ ] **Step 4: Run the row tests and verify they pass**

Run: `cd app/client && npx vitest run src/component/book-request-row`
Expected: PASS, including the pre-existing "who may delete" and "resolve actions" suites.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/component/book-request-row
git commit -m "feat(client): edit a pending book request in place"
```

---

### Task 6: Full verification

**Files:** none new.

- [ ] **Step 1: Server tests**

Run: `cd app/server && npm test`
Expected: all PASS.

- [ ] **Step 2: Client tests**

Run: `cd app/client && npm test`
Expected: all PASS.

- [ ] **Step 3: Lint, from the repo root**

Run: `npm run lint`
Expected: both workspaces clean, including `graphql:schema:check` and `codegen:check`. Fix any formatting with `npm run lint:fix` and re-run.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A app
git commit -m "chore: lint fixes for book request editing"
```

(Skip if the tree is clean.)
