# Step 8 — Progress screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both progress screens and the link modal entirely onto GraphQL, and delete
`ProgressProvider` — the last raw-id-keyed client cache.

**Architecture:** A new nullable `Progress.book` edge (batched server-side) lets progress rows render
fetch-free off the connection. The viewer's list roots at `node(id: $libraryId)`; an admin viewing
another user roots at `Query.user(id:)`. Reads are lazy-on-expand with `fetchMore`; the count comes
from `viewer.user.progressCount` so a collapsed card fetches nothing.

**Tech Stack:** graphql-yoga + Pothos v4 + Prisma (server); Apollo Client v4 + `client-preset`
codegen with **fragment masking ON** (client); vitest + `@testing-library/react` both sides.

**Spec:** `docs/superpowers/specs/2026-08-23-step8-progress-design.md`

## Global Constraints

- **Base:** `2ea303c4`. Server 2014/2014, client 1149/1149, `test:cost` 33/33, lint + codegen + SDL clean.
- **The client never encodes or decodes a Relay global ID.** Raw hashes come from
  `Progress.document`; global ids come from the server.
- **Fragment masking is COMPILE-TIME ONLY here.** `FragmentType` is a type-only marker
  (`gql/fragment-masking.ts`), `useFragment` is a generated *identity cast*, `dataMasking` is never
  enabled — masked data is NOT stripped at runtime. Never assert
  `expect(x).not.toHaveProperty(...)` to "prove masking"; prove it at the TYPE level with
  `@ts-expect-error`, enforced by `tsc --noEmit`.
- **Loaders capture `reject` and wrap query + grouping in one try/catch.** A loader that only
  captures `resolve` hangs the request on a DB error — that bug shipped once here
  (`progress-loader`). Batch by `(userId, document)` PAIRS, never a bare `document IN (...)`: a
  KOReader content hash collides across tenants.
- **Every shipped operation stays under 70% of both cost budgets** (BREADTH 100, COMPLEXITY 33,000).
  Measure with `costOf()` from `app/server/graphql/cost-test-support.ts`.
- **Error-surfacing policy:** screen hooks return `error: string | undefined` from Apollo's
  `error?.message`. A first-page failure with no data is the empty-error state; a `fetchMore`
  failure keeps existing rows and offers retry.
- **Compose the test harness the way `App.tsx` composes.** Step 6 shipped a user-visible bug because
  a provider the page depended on was absent from the harness, leaving its setters as silent no-ops.
- **When replacing a hook, diff the OLD hook's side effects against the new one, item by item.**
  Step 7's whole-branch review found a hook swap silently dropped two of three cache-coherence side
  effects, and the missing one failed silently under `relayStylePagination`.
- **Seen-to-fail is mandatory** for every property-protecting test, re-run at the branch tip in the
  final task.
- **Verify against code, never transcribe from docs.** Where this plan and the code disagree, the
  code wins and this plan gets corrected in place.
- **Commands (verified — do not substitute):**
  - `npm run graphql:schema -w app/server` **WRITES** the SDL; `npm run test -w app/server -- print-schema` only CHECKS it.
  - `npm run codegen -w app/client` **WRITES** `src/gql/`; `npm run lint -w app/client` only CHECKS it.
  - `npm run test -w app/server`, `npm run test -w app/client`, `npm run test:cost -w app/server`, `npm run lint` (root).

## What this plan does NOT do

Steps 9 and 10: upload/replace, `BookProvider`'s deletion, the final `apiFetch` sweep. Also out:
step 7's parked follow-ups (the truthy guard that prevents clearing a field to empty; `Library.series`
going stale after a save creates a series).

**Do NOT delete `useBook` or `use-fetch-book.ts`.** They become dead when the two progress rows stop
calling them — verified: those are their only two non-test consumers. But step 10 owns
`BookProvider`, and half-dismantling it across two steps is exactly how the survivor counts in steps
6 and 7 both went wrong. Task 8 records them as step 10's, with the trace.

## File Structure

**Server — create:** `app/server/graphql/book-by-document-loader.ts` (+ test).
**Server — modify:** `graphql/context.ts`, `graphql/schema/progress/model.ts`,
`graphql/schema.generated.graphql`, `graphql/schema/progress/model.test.ts`.

**Client — create:** `graphql/progress.ts` (documents), `provider/library/hook/use-my-progress-list.ts`,
`.../use-user-progress-list.ts`, `provider/library/hook/use-progress-mutations.ts` (+ tests).

**Client — modify:** `component/my-progress/`, `my-progress-content/`, `my-progress-row/`,
`user-row-content/`, `user-progress-row/`, `control/link-progress-modal/`,
`control/set-progress-modal/`, `page/book/index.tsx`, `provider/book/hook/use-patch-book-metadata.ts`,
`provider/book/hook/use-replace-book.ts`, `App.tsx`.

**Client — delete:** all of `provider/progress/` (context, provider, type, index, and all **ten**
hooks with their tests), and `control/link-progress-modal/use-user-book-list.ts`.

---

## Task 1: `Progress.book` and its batching loader

**Files:**
- Create: `app/server/graphql/book-by-document-loader.ts`, `.../book-by-document-loader.test.ts`
- Modify: `app/server/graphql/context.ts`, `app/server/graphql/schema/progress/model.ts`,
  `app/server/graphql/schema.generated.graphql`
- Test: `app/server/graphql/schema/progress/model.test.ts`

**Interfaces:**
- Produces: `createBookByDocumentLoader(prisma: PrismaClient): BookByDocumentLoader`, where
  `BookByDocumentLoader = (userId: string, document: string) => Promise<Book | null>`; wired as
  `context.loadBookByDocument`; SDL gains `Progress.book: Book`.

**The `document` IS the book's raw id.** `Progress.document` is a KOReader content hash, and a
book's own `Book.id` is that same content hash — so the lookup is `prisma.book.findMany` over
`(userId, id)` pairs. **Verify that against `schema.prisma` before writing it**; if the relationship
is not what this paragraph says, stop and report rather than coding around it.

**The closest sibling is `app/server/graphql/validation-counts-loader.ts`** (or
`series-progress-loader.ts`). Read one in full first — same cache/pending/flush/`queueMicrotask`
structure, same resolve/reject-both discipline, same doc-comment density.

- [ ] **Step 1: Write the failing loader tests**

```ts
// app/server/graphql/book-by-document-loader.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createBookByDocumentLoader } from './book-by-document-loader';

type BookRow = { userId: string; id: string; title: string };

const prismaWith = (rows: BookRow[], findMany = vi.fn().mockResolvedValue(rows)) => ({
  prisma: { book: { findMany } } as never,
  findMany,
});

describe('createBookByDocumentLoader', () => {
  it('batches every pending lookup into ONE findMany call', async () => {
    const { prisma, findMany } = prismaWith([
      { userId: 'u1', id: 'doc-a', title: 'A' },
      { userId: 'u1', id: 'doc-b', title: 'B' },
    ]);
    const load = createBookByDocumentLoader(prisma);

    const [a, b] = await Promise.all([load('u1', 'doc-a'), load('u1', 'doc-b')]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(a?.title).toBe('A');
    expect(b?.title).toBe('B');
  });

  it('resolves null for a document with no book in the library', async () => {
    const { prisma } = prismaWith([]);
    const load = createBookByDocumentLoader(prisma);

    await expect(load('u1', 'not-in-library')).resolves.toBeNull();
  });

  it('scopes by (userId, document) PAIRS, never a bare document IN (...)', async () => {
    const { prisma, findMany } = prismaWith([]);
    const load = createBookByDocumentLoader(prisma);

    await Promise.all([load('u1', 'doc-a'), load('u2', 'doc-a')]);

    const where = findMany.mock.calls[0][0].where as { OR: unknown[] };
    expect(where.OR).toEqual([
      { userId: 'u1', id: 'doc-a' },
      { userId: 'u2', id: 'doc-a' },
    ]);
  });

  it('does not leak one tenant’s book to another asking for the same hash', async () => {
    const { prisma } = prismaWith([{ userId: 'u1', id: 'shared-hash', title: 'Alice copy' }]);
    const load = createBookByDocumentLoader(prisma);

    const [alice, bob] = await Promise.all([
      load('u1', 'shared-hash'),
      load('u2', 'shared-hash'),
    ]);

    expect(alice?.title).toBe('Alice copy');
    expect(bob).toBeNull();
  });

  it('REJECTS every pending lookup when the query throws — never hangs the request', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('db down'));
    const load = createBookByDocumentLoader({ book: { findMany } } as never);

    await expect(Promise.all([load('u1', 'a'), load('u1', 'b')])).rejects.toThrow('db down');
  });

  it('memoizes per key: a repeat lookup issues no second query', async () => {
    const { prisma, findMany } = prismaWith([{ userId: 'u1', id: 'doc-a', title: 'A' }]);
    const load = createBookByDocumentLoader(prisma);

    await load('u1', 'doc-a');
    await load('u1', 'doc-a');

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
```

The cross-tenant test is the one that matters most: a KOReader content hash is the same string for
the same file on two users' shelves, so a bare `id IN (...)` would return Alice's row to Bob.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/server -- book-by-document-loader`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loader**

Mirror `validation-counts-loader.ts` exactly in structure. The flush:

```ts
const books = await prisma.book.findMany({
  where: { OR: batch.map(({ userId, document }) => ({ userId, id: document })) },
});

const byUser = new Map<string, Map<string, (typeof books)[number]>>();
for (const book of books) {
  const byDocument = byUser.get(book.userId) ?? new Map();
  byDocument.set(book.id, book);
  byUser.set(book.userId, byDocument);
}

for (const lookup of batch) {
  lookup.resolve(byUser.get(lookup.userId)?.get(lookup.document) ?? null);
}
```

Wrap the whole thing in one try/catch that rejects every pending lookup.

**Select enough columns for the GraphQL `Book` type to resolve from the row.** Check how
`Library.book`'s resolver returns a book — if the Pothos prisma plugin expects a full row or a
`query` selection, match that. Do not guess: read `schema/library/model.ts`'s `book` field first.

- [ ] **Step 4: Prove the reject path is load-bearing**

Change the `catch` to swallow, re-run. Expected: the rejection test **times out** rather than failing
an assertion — that timeout is the hang this discipline prevents. Restore the `catch`.

- [ ] **Step 5: Wire the context and add the field**

`app/server/graphql/context.ts` — mirror the five existing loaders:

```ts
import { createBookByDocumentLoader, type BookByDocumentLoader } from './book-by-document-loader';
// … in the context type:  loadBookByDocument: BookByDocumentLoader;
// … in the factory:       loadBookByDocument: createBookByDocumentLoader(deps.prisma),
```

**Also add it to `app/server/graphql/test-util.ts`** — that harness builds `Context` by hand rather
than via `createContext`, so a new required field breaks `tsc` there. (A prior task hit exactly this.)

`app/server/graphql/schema/progress/model.ts` — add:

```ts
    /**
     * The library book this reading position belongs to, or null when the
     * document is not in this library at all — a KOReader device syncs
     * progress for whatever it is reading, including books never imported
     * here. Those rows still render; they simply have no book to link to.
     *
     * Mirrors `LinkedDocument.oldBook`/`newBook`: a raw content hash for
     * display (`document`) beside a resolvable edge for navigation.
     *
     * Resolved through `context.loadBookByDocument` — a request-scoped
     * batching loader, NOT a per-parent query, because a page of progress
     * rows is up to `CONNECTION_LIMITS.libraryProgress.maxSize` (100) deep.
     * Batched by `(userId, document)` PAIRS: `document` is a content hash
     * that COLLIDES across tenants.
     */
    book: t.field({
      type: bookType,
      nullable: true,
      resolve: (progress, _args, context) =>
        context.loadBookByDocument(progress.userId, progress.document),
    }),
```

Check how `progress/model.ts` currently imports sibling types before writing `bookType`'s import.

- [ ] **Step 6: Add the schema tests, regenerate, run the gates**

Add to `schema/progress/model.test.ts`, following that file's harness: a progress row whose document
IS a library book resolves `book { id title }`; one whose document is not resolves `book: null`; and
a page of rows fires ONE `findMany` (spy on `prisma.book.findMany`, seed at least three rows — a
single-row fixture proves nothing about batching).

```bash
npm run graphql:schema -w app/server
npm run test -w app/server
npm run test:cost -w app/server
```

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql
git commit -m "feat(server): add Progress.book, a batched nullable edge to the library book"
```

---

## Task 2: The documents, measured

**Files:**
- Create: `app/client/src/graphql/progress.ts`
- Modify: `app/client/src/gql/` (regenerated)

**Interfaces:**
- Produces: `ProgressRowFragment`, `MyProgressListDocument`, `MyProgressCountDocument`,
  `UserProgressListDocument`, `ProgressSetDocument`, `ProgressDeleteDocument`,
  `BookLinkDocumentDocument`, `LinkPickerBooksDocument`.

**Measure before building on it.** Steps 6 and 7 both put the cost measurement first and it paid off
each time.

- [ ] **Step 1: Write the documents**

```ts
// app/client/src/graphql/progress.ts
import { graphql } from '~/gql';

/**
 * One progress row. `book` is NULLABLE by design — a device syncs progress for
 * documents that are not in this library, and those rows still render with the
 * raw `document` hash and no book link.
 *
 * `id` is `Progress`'s computed global id — the cache key AND `progressDelete`'s
 * argument. It is deliberately NOT resolvable through `node(id:)`; `Progress` is
 * not a `Node`. `document` is the RAW content hash and is what `progressSet`
 * takes.
 */
export const ProgressRowFragment = graphql(`
  fragment ProgressRowFragment on Progress {
    id
    document
    percentage
    currentChapter
    device
    timestamp
    book {
      id
      title
      author
      hasCover
      thumbnailUrl(width: 88)
    }
  }
`);

/**
 * The viewer's own progress. `first: 50` matches
 * `CONNECTION_LIMITS.libraryProgress.defaultSize`; the cap is 100.
 * Forward-only — `Library.progress` rejects `last`/`before`.
 *
 * Measured (`npm run test:cost -w app/server`): breadth <N> (<N>%), complexity
 * <N> (<N>%). REPLACE WITH REAL NUMBERS in Step 3.
 */
export const MyProgressListDocument = graphql(`
  query MyProgressList($libraryId: ID!, $first: Int!, $after: String) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        progress(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              ...ProgressRowFragment
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

/**
 * The collapsed card's subtitle, with NO rows fetched.
 *
 * `viewer.user`, not `Query.user(id:)` — the latter is admin-only and refuses a
 * non-admin even for their own id. `Viewer.user` is NULLABLE and is null for the
 * config-based admin, which has no `User` row (the same reason `viewer.library`
 * is null for it).
 */
export const MyProgressCountDocument = graphql(`
  query MyProgressCount {
    viewer {
      user {
        id
        progressCount
      }
    }
  }
`);

/**
 * An admin viewing ANOTHER user's progress. Roots at `Query.user(id:)`, not
 * `node(id: $libraryId)` — the target is a different user's library, and
 * `UserRow` already holds their `userId`. `Query.user(id:)` is admin-only, which
 * is correct here: this row renders only for admins.
 */
export const UserProgressListDocument = graphql(`
  query UserProgressList($userId: ID!, $first: Int!, $after: String) {
    user(id: $userId) {
      id
      library {
        id
        progress(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              ...ProgressRowFragment
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

export const ProgressSetDocument = graphql(`
  mutation ProgressSet($input: ProgressSetInput!) {
    progressSet(input: $input) {
      __typename
      ... on ProgressSetPayload {
        progress {
          id
          ...ProgressRowFragment
        }
        library { id }
      }
    }
  }
`);

export const ProgressDeleteDocument = graphql(`
  mutation ProgressDelete($id: ID!) {
    progressDelete(input: { id: $id }) {
      __typename
      ... on ProgressDeletePayload {
        deletedId
        library { id }
      }
    }
  }
`);

export const BookLinkDocumentDocument = graphql(`
  mutation BookLinkDocument($id: ID!, $documentId: String!) {
    bookLinkDocument(input: { id: $id, documentId: $documentId }) {
      __typename
      ... on BookLinkDocumentPayload {
        book { id lineage { oldId newId type } }
      }
      ... on DocumentAlreadyLinkedError { message }
      ... on DocumentIsBookError { message }
      ... on SelfLinkError { message }
      ... on InvalidInputError { message }
    }
  }
`);

/**
 * The link modal's book picker. Server-side filtered via `LibraryFilter.query`
 * + `entryType: BOOK`, replacing a fetch-the-whole-library-then-filter-locally
 * REST hook. `Library.entries` returns the `LibraryEntry` union (`Book | Series`),
 * so the picker narrows on `__typename`.
 */
export const LinkPickerBooksDocument = graphql(`
  query LinkPickerBooks($libraryId: ID!, $query: String) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        entries(first: 20, filter: { query: $query, entryType: BOOK }) {
          edges {
            node {
              __typename
              ... on Book {
                id
                title
                author
              }
            }
          }
        }
      }
    }
  }
`);
```

- [ ] **Step 2: Verify every union member and payload field against the SDL**

Before regenerating, check each against `app/server/graphql/schema.generated.graphql`:

- `ProgressSetResult` / `ProgressDeleteResult` — what members do they actually have? Add no branch
  the schema lacks, omit none it has.
- `ProgressSetPayload` / `ProgressDeletePayload` — do they carry the fields selected above?
- `BookLinkDocumentResult`'s four error members — verify each exists and exposes `message`.
- `LibraryEntryType` — confirm the enum value is spelled `BOOK`.

A branch the schema lacks fails codegen; a member omitted silently swallows a real error.

- [ ] **Step 3: Regenerate, measure, record**

```bash
npm run codegen -w app/client
npm run test:cost -w app/server
```

Write the real numbers into each query's doc comment, matching `graphql/book.ts`'s convention.
**`$first` is a VARIABLE here, so the connections price at `maxSize` (100), not 50** — expect these
to cost more than the literal-page-size documents elsewhere in the codebase. If any lands over 70%,
the lever is a literal `first: 50` in place of the variable (pagination then uses `after` only);
report before doing it.

- [ ] **Step 4: Run the gates and commit**

```bash
npm run lint -w app/client && npm run lint
git add app/client/src/graphql app/client/src/gql
git commit -m "feat(client): add the progress documents, measured under budget"
```

---

## Task 3: The progress mutation hooks

**Files:**
- Create: `app/client/src/provider/library/hook/use-progress-mutations.ts`, `.../use-progress-mutations.test.tsx`
- Modify: `provider/library/hook/index.ts`, `provider/library/index.ts`

**Interfaces:**
- Produces three hooks, each a named object (NOT the old 4-tuples — every call site is rewritten in
  this step, so there is no compatibility to preserve):
  ```ts
  export const useSetMyProgress: (documentId: string) => {
    setProgress: (args: { currentChapter: number; percentage: number }) => Promise<boolean>;
    saving: boolean; error: string | undefined;
  };
  export const useDeleteProgress: () => {
    deleteProgress: (progressId: string) => Promise<boolean>;
    deleting: boolean; error: string | undefined;
  };
  export const useLinkProgress: (bookGlobalId: string) => {
    link: (documentId: string) => Promise<boolean>;
    linking: boolean; error: string | undefined;
  };
  ```

**One delete hook, not two.** `useDeleteMyProgress` and `useDeleteUserProgress` both become
`useDeleteProgress`: `progressDelete` takes a `Progress.id` and authorises the DECODED owner, so it
is genuinely admin-capable and the two paths differ only in which id they pass.

**`progressSet` is viewer-only.** `ProgressSetInput.userId` must be the viewer's own User global id
— the server 403s admins, and there is no admin write path. Read the viewer's id from
`MyProgressCountDocument`'s `viewer.user.id` or an equivalent; do NOT accept a userId argument, which
would imply a capability that does not exist.

**Pattern conformance:** the mutation hooks in `provider/book/hook/` are one convention — same
`Extract<NonNullable<…>, {__typename}>` payload alias, same in-flight guard, same
`try/catch/finally`, same `unwrapResult` ladder. Read one before writing.

**Diff the old hooks' side effects.** `useSetMyProgress` and `useDeleteMyProgress` each performed an
**optimistic local write** into the REST map and rolled it back on failure. Their replacements need
cache updates producing the same observable result: a set must make the new percentage visible
immediately; a delete must remove the row. Enumerate each old side effect in your report and say what
replaces it.

- [ ] **Step 1: Write the failing tests**

Cover, each asserting on the CACHE via `client.cache` (which `renderHookWithApollo` returns):

```tsx
it('adds the new progress to the cached connection after a set', async () => {});
it('removes the row from the cached connection after a delete', async () => {});
it('maps a delete failure to an error message and leaves the row in place', async () => {});
it('does not fire a second mutation while one is in flight', async () => {});
it('maps DocumentAlreadyLinkedError to an error message', async () => {});
it('sends the RAW document to progressSet, never the Progress global id', async () => {
  const DOCUMENT = 'a'.repeat(32);            // raw content hash
  const PROGRESS_ID = 'UHJvZ3Jlc3M6MQ==';     // deliberately unrelated global id

  const { result } = renderHookWithApollo(() => useSetMyProgress(DOCUMENT), [
    {
      request: {
        query: ProgressSetDocument,
        variables: {
          input: { document: DOCUMENT, userId: VIEWER_USER_ID, currentChapter: 3, percentage: 0.5 },
        },
      },
      result: { data: progressSetPayload({ id: PROGRESS_ID, document: DOCUMENT }) },
    },
  ]);

  await act(async () => {
    await result.current?.setProgress({ currentChapter: 3, percentage: 0.5 });
  });

  // MockLink throws on an unmatched operation, so a mutation carrying
  // PROGRESS_ID where DOCUMENT belongs would fail to match and surface as an
  // error — that is what makes this assertion load-bearing rather than
  // co-incidentally true.
  expect(result.current?.error).toBeUndefined();
});

it('sends the Progress GLOBAL id to progressDelete, never the raw document', async () => {
  const DOCUMENT = 'a'.repeat(32);
  const PROGRESS_ID = 'UHJvZ3Jlc3M6MQ==';

  const { result } = renderHookWithApollo(() => useDeleteProgress(), [
    {
      request: { query: ProgressDeleteDocument, variables: { id: PROGRESS_ID } },
      result: { data: progressDeletePayload({ deletedId: PROGRESS_ID }) },
    },
  ]);

  await act(async () => {
    await result.current?.deleteProgress(PROGRESS_ID);
  });

  expect(result.current?.error).toBeUndefined();
  // And the inverse: passing the raw document must NOT match the mock.
  // Assert that explicitly rather than trusting the happy path.
});
```

Write each out fully against the real generated types. The last two are the identity-seam guards
this migration has needed at every step — give them deliberately different literal values.

- [ ] **Step 2: Run and confirm failure. Implement. Confirm pass.**

Run: `npm run test -w app/client -- use-progress-mutations`

- [ ] **Step 3: Seen-to-fail every cache update**

For each hand-written `update`, delete it, confirm ONLY its own test fails and with the claimed
failure mode, restore it, and record the failure mode in the hook's doc comment. Where Apollo's
normalization suffices instead, say so explicitly AND assert the cache, so a future normalization
change is caught.

- [ ] **Step 4: Commit**

```bash
npm run test -w app/client
git add app/client/src/provider/library
git commit -m "feat(client): set, delete and link progress over GraphQL"
```

---

## Task 4: The viewer's progress screen

**Files:**
- Create: `provider/library/hook/use-my-progress-list.ts` (+ test)
- Modify: `component/my-progress/index.tsx`, `component/my-progress-content/index.tsx`,
  `component/my-progress-row/index.tsx`, and their tests

**Interfaces:**
- Produces:
  ```ts
  export const useMyProgressList: (options: { skip: boolean }) => {
    rows: FragmentType<typeof ProgressRowFragment>[];
    hasNextPage: boolean;
    loadMore: () => void;
    loadingMore: boolean;
    loading: boolean;
    error: string | undefined;
  };
  ```
  `skip` is what makes the collapsed card fetch nothing.

**The closest sibling is `provider/library/hook/use-library-entries.ts`** — same connection shape,
same `fetchMore` handling, same masked-ref stance. Read it first. **Return MASKED refs**: each row
component calls `useFragment` once in its own body, which is what avoids the
`react-hooks/rules-of-hooks` collision a shared unmask inside a `.map()` would hit.

**Wiring:**
- `MyProgress` (the card) reads `MyProgressCountDocument` for its subtitle and passes
  `skip: collapsed` down. Handle `viewer.user === null` (the config-based admin) by rendering no
  subtitle — check what the REST screen does there first and preserve it.
- `MyProgressContent` renders rows plus the "Load more" affordance.
- `MyProgressRow` unmasks one ref and renders **fetch-free** — it no longer calls `useBook` or
  `useMyProgress`. When `book` is null, render the raw `document` and no book link.

- [ ] **Step 1: Port and extend the tests**

`my-progress-row/index.test.tsx` has **13** cases. Read them and port each; name any judged
inapplicable, with a reason.

**Close the fixture gap the spec names (§8).** These tests previously ran against a harness that
never mounted `ProgressProvider`, so the mutation hooks' setters were silent no-ops and a broken
clear-progress path could not be observed — exactly the bug step 6 shipped. The provider is gone, so
the gap cannot recur in that form, but the replacement tests must genuinely exercise the mutations
against a real cache rather than inherit stubs that assert nothing. Say in your report how each
mutation test proves its effect. `my-progress`, `my-progress-content` have no tests today — add the ones
the new behaviour needs. Then add:

```tsx
it('fetches no rows while the card is collapsed', async () => {
  // MockLink throws on an unmatched operation, so supplying ONLY the count mock
  // is what proves no list query fired — state that mechanism in the comment
});
it('fetches the first page when the card is expanded', async () => {});
it('grows the list via Load more without refetching page one', async () => {});
it('renders a row whose book is null using the raw document, with no book link', async () => {});
it('renders no subtitle when viewer.user is null (config admin)', async () => {});
```

- [ ] **Step 2: Run and confirm failure. Rewrite the three components. Confirm pass.**

Run: `npm run test -w app/client -- my-progress`

- [ ] **Step 3: Commit**

```bash
git add app/client/src/component/my-progress app/client/src/component/my-progress-content app/client/src/component/my-progress-row app/client/src/provider/library
git commit -m "feat(client): drive the viewer's progress screen from GraphQL"
```

---

## Task 5: The admin's view of a user's progress

**Files:**
- Create: `provider/library/hook/use-user-progress-list.ts` (+ test)
- Modify: `component/user-row-content/index.tsx`, `component/user-progress-row/index.tsx`, and tests

**Interfaces:**
- Produces `useUserProgressList(userId: string, options: { skip: boolean })` — the same return shape
  as `useMyProgressList`, rooted at `UserProgressListDocument` instead.

**`UserRow` already holds `userId`** (a User global ID, from step 4's `/users` migration) — pass it
down rather than resolving a username to an id.

`UserProgressRow` mirrors `MyProgressRow`: unmasks one ref, renders fetch-free, no `useBook`. Its
delete uses `useDeleteProgress` with the row's `Progress.id`.

- [ ] **Step 1: Port and extend the tests**

`user-progress-row/index.test.tsx` has **12** cases. Port each; name any inapplicable. The same
fixture-gap requirement as Task 4 applies here: these tests must exercise the delete mutation against
a real cache, not a stub. Add:

```tsx
it('roots at Query.user for the target user, not the viewer’s library', async () => {
  // assert the operation's variables carry the TARGET userId, with a literal
  // deliberately different from the viewer's
});
it('deletes using the row’s Progress id', async () => {});
it('renders a row whose book is null using the raw document', async () => {});
```

- [ ] **Step 2: Run and confirm failure. Implement. Confirm pass. Commit.**

```bash
npm run test -w app/client -- user-progress user-row-content
git add app/client/src/component/user-row-content app/client/src/component/user-progress-row app/client/src/provider/library
git commit -m "feat(client): drive the admin progress view from GraphQL"
```

---

## Task 6: The link modal

**Files:**
- Modify: `control/link-progress-modal/index.tsx` (+ test)
- Delete: `control/link-progress-modal/use-user-book-list.ts` (+ its test)

The picker currently fetches a user's ENTIRE library and filters client-side as the user types.
Against a bounded connection that does not translate. It becomes
`LinkPickerBooksDocument` — `Library.entries(filter: { query, entryType: BOOK })`, server-side
filtered, the same mechanism the library grid's search uses.

**This is a real interaction change** — a round trip per query instead of an instant local filter.
Debounce the input so a keystroke does not equal a request; check whether the codebase already has a
debounce helper before adding one.

`Library.entries` returns the `LibraryEntry` union (`Book | Series`), so narrow on `__typename`
even with `entryType: BOOK` set — the filter constrains the server, the union constrains the types.

- [ ] **Step 1: Write the failing tests**

```tsx
it('queries with the typed filter and lists the returned books', async () => {});
it('does not query until the modal is open', async () => {});
it('links the selected book to the document via bookLinkDocument', async () => {});
it('surfaces DocumentAlreadyLinkedError as a message and keeps the modal open', async () => {});
```

- [ ] **Step 2: Run and confirm failure. Implement. Confirm pass. Commit.**

```bash
npm run test -w app/client -- link-progress-modal
git add app/client/src/control/link-progress-modal
git commit -m "feat(client): filter the link picker server-side and link over GraphQL"
```

---

## Task 7: Teardown — the bridge, the renames, and the provider

**Files:**
- Modify: `control/set-progress-modal/index.tsx`, `page/book/index.tsx`,
  `provider/book/hook/use-patch-book-metadata.ts`, `provider/book/hook/use-replace-book.ts`,
  `App.tsx`
- Delete: all of `app/client/src/provider/progress/`

**Three things, in this order:**

1. **Rewire `SetProgressModal`** to `useSetMyProgress` (Task 3) and `useDeleteProgress`. It currently
   takes a `documentId` prop — that stays correct, since `progressSet` takes the raw document.
2. **Remove the STEP-8 BRIDGE.** `SetProgressModal`'s `onSaved` prop and `page/book`'s
   `onSaved={refetch}` exist only because the modal wrote over REST while the page read from Apollo.
   Once `progressSet`'s payload normalizes onto the same `Progress` entity, both are dead weight —
   the prop's own doc comment names this migration as the trigger. **Verify the page's displayed
   percentage still updates after a save with the bridge gone**, and keep a test proving it.
3. **Remove the two `renameProgressKey` calls** — `use-patch-book-metadata.ts:125` and
   `use-replace-book.ts:145` — and their now-unused `ProgressContext` imports. Then delete
   `provider/progress/` entirely and unmount `ProgressProvider` from `App.tsx`.

**Why removing the renames is safe, and what to say in the commit:** once every reader of the REST
progress map is migrated, the map is write-only. The rename's real purpose — keeping progress
attached across an id rotation — is served server-side: `bookStore.resolveBookId` resolves old ids
through `book_id_history`, and `reimportBook` migrates the `Progress` row inside the rotation's own
transaction. Both were verified in step 7 and are recorded in the parent spec's §15. **Re-verify them
rather than trusting this paragraph.**

- [ ] **Step 1: Confirm nothing else touches the provider**

```bash
grep -rn "provider/progress\|ProgressContext\|ProgressProvider" app/client/src --include='*.ts' --include='*.tsx'
```

Everything remaining must be inside `provider/progress/` itself (about to be deleted) or the two call
sites above. **If anything else appears, stop and report** — that is the wrapper-hides-a-caller
pattern this codebase has been bitten by three times.

- [ ] **Step 2: Write the failing test for the bridge removal**

```tsx
it('updates the displayed percentage after a save, with no refetch', async () => {
  // ONE BookDetail mock only: a refetch would be an unmatched operation and throw.
  // The percentage must update from progressSet's payload normalizing onto the
  // same Progress entity — that is what replaces the bridge.
});
```

- [ ] **Step 3: Do the three changes. Run the full client suite. Confirm pass.**

- [ ] **Step 4: Commit**

```bash
git rm -r app/client/src/provider/progress
git add -A
git commit -m "refactor(client): delete ProgressProvider and the step-8 bridge"
```

---

## Task 8: Sweep, re-verify, and correct the documents

- [ ] **Step 1: Count and reconcile**

```bash
grep -rn 'useWithTargetUser(' app/client/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l
```

Expected: **7**, unchanged — no progress hook used it (verified when the spec was written). **Do not
adjust the expectation to match the count.** If it differs, investigate and report.

- [ ] **Step 2: Verify what is now dead, transitively**

Apply the standing rule: "hook X is dead" has been wrong **three** times here when checked only for
direct importers, because wrapper hooks hide live callers. Trace each past its direct importers,
including barrel re-exports, and record the trace.

1. **`useBook` and `use-fetch-book.ts`** — the two progress rows were their only non-test consumers.
   Confirm they now have zero, and **leave them in place**: step 10 owns `BookProvider`. Record them
   as step 10's with the trace.
2. **`lib/cover-url.ts`** — check whether the progress rows were among its last callers.
3. Anything the deleted `provider/progress/` was the last consumer of.

- [ ] **Step 3: Re-run every seen-to-fail at the branch tip**

Not at the commit that introduced them — a guard can go stale when a later fix subsumes its effect,
which has happened twice on this branch. Cover: the loader's reject path (must TIME OUT, not fail an
assertion), and every cache update in Task 3. Any test that no longer fails is redundant or
protecting the wrong thing; fix or delete it and say which.

- [ ] **Step 4: All gates**

```bash
npm run test -w app/server        # was 2014
npm run test -w app/client        # was 1149
npm run test:cost -w app/server
npm run lint
npm run lint -w app/client
```

- [ ] **Step 5: Correct the documents**

Verify each before editing.

- **Parent spec §9 row 8** — mark ✅ Complete with real counts. The row's claim that this step ends
  with `ProgressProvider` deleted is TRUE, but only because this step also removed two step-9 hooks'
  calls into it; say so.
- **Parent spec §15** — record the link modal's filtering change (server round trip per query,
  replacing an instant local filter over a full fetch), and the collapsed card no longer fetching
  rows. Confirm or drop each by what actually shipped.
- **The step-8 spec's §7** — update if the sweep found the survivor list wrong.
- **`docs/superpowers/notes/2026-08-13-step6-surface-map.md`** — update any row this step changed.

- [ ] **Step 6: Commit**

```bash
git add docs app/client app/server
git commit -m "docs: record step 8's outcome and correct the specs it contradicted"
```

---

## Definition of done

- Both progress screens and the link modal read and mutate entirely over GraphQL.
- `Progress.book` shipped with a batching loader whose reject path is proven load-bearing.
- `ProgressProvider`, its context, and all ten hooks deleted; both `renameProgressKey` calls removed;
  the STEP-8 BRIDGE gone with a test proving the page still updates.
- `useBook`/`use-fetch-book` confirmed dead, recorded as step 10's, and NOT deleted here.
- `useWithTargetUser` still at 7.
- Both suites green, `test:cost` green with no document over 70%, lint + codegen + SDL clean.
- Divergences recorded in the parent spec's §15.
