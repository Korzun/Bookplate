import { graphql } from '~/gql';

/**
 * The book-detail route's own read, composed HERE rather than in
 * `~/graphql/book.ts`: `page/book` is its only consumer (the REST-era
 * `useBookDetail` indirection this replaced had exactly one call site), and
 * the placement rule this project follows puts a single-route document in a
 * route-adjacent module. It lives in a SIBLING file rather than
 * `./index.tsx` only because that route file is already 440+ lines.
 *
 * Rooted `node(id: $libraryId) { ... on Library { book(id: $bookId) } }` —
 * `node(id:)` is the only single root that serves both a non-admin's own
 * library and an admin's selected one (see `useCurrentLibraryId`'s doc
 * comment). The two lazy documents below root IDENTICALLY, on purpose; see
 * `BookChaptersDocument` for why that is load-bearing rather than
 * copy-paste.
 *
 * **What this document deliberately does NOT select** (2026-08-26, the
 * lazy-split task — this project's headline cost deliverable):
 *
 * - `chapterNames` / `chapterSpineMap` — read ONLY by `SetProgressModal`,
 *   which this route renders as `{progressModalOpen && …}`. Split into
 *   `BookChaptersDocument`.
 * - `lineage` / `addedAt` — read ONLY by `BookLineageModal`, rendered
 *   `{lineageModalOpen && …}`. Split into `BookLineageDocument`.
 * - `pendingFix { id }` — read by NOTHING. It reached only a hand-written
 *   type declaration on the deleted `useBookDetail` hook and was never
 *   dereferenced by any consumer; `page/book-edit` reads its own,
 *   separate `BookEditDocument.book.pendingFix`. Deleted outright rather
 *   than split — two selections of pure dead breadth.
 *
 * **What deliberately STAYS eager**, against the "a conditionally-rendered
 * subtree gets its own lazy query" default:
 *
 * - `deviceEditionCount` feeds `buildBookActions` (`./actions.ts`), which
 *   builds the header action menu on EVERY visit — it is not something a
 *   user can choose not to see, so splitting it would add a request to
 *   every page view to save nothing.
 * - `chapterCount` likewise gates whether the "Set progress" action exists
 *   at all, and is rendered in the metadata list.
 * - `validation { id valid }` gates "Edit metadata" on page LOAD, so it
 *   cannot wait for a modal — the same reasoning that kept it here when the
 *   expensive rest of `Validation` was split into `BookValidationDocument`
 *   on 2026-08-13 (`~/graphql/book.ts`).
 *
 * NOTE for future trims: breadth is 1 per selection in the EXPANDED tree,
 * unweighted by any connection multiplier (`cost-limit.ts`). There is no
 * list connection above `book` here, so nothing amplifies — cut FIELDS (or
 * split them out, as above), never page sizes, if breadth gets tight.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 37 (37.0%),
 * complexity 37 (0.1%) of budget — down from breadth 50 (50.0%) /
 * complexity 164 (0.5%) before the split. The complexity fall is almost
 * all `lineage`: it is a LIST field, so every selection under it was
 * priced against that list's multiplier, while the scalars removed
 * alongside it cost 1 each.
 */
export const BookDetailDocument = graphql(`
  query BookDetail($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          documentId
          title
          author
          description
          publisher
          publishDate
          mtime
          size
          pageCount
          chapterCount
          subjects
          seriesIndex
          hasCover
          coverUrl
          deviceEditionCount
          series {
            id
            name
          }
          progress {
            id
            percentage
            currentChapter
          }
          validation {
            id
            valid
          }
        }
      }
    }
  }
`);

/**
 * `SetProgressModal`'s own data, fetched only once that modal is opening —
 * `page/book` gates this document's `useQuery` on the SAME boolean that
 * mounts the modal, and prefetches it on hover/focus/touch of the "Set
 * progress" action (`usePrefetchOnIntent`) so the click usually finds the
 * result already in flight or cached.
 *
 * **Cache identity — the constraint every split here must satisfy.** This
 * document roots identically to `BookDetailDocument` and selects `id`, so
 * its result normalizes onto the SAME `Book:<id>` entity that document
 * already created: Apollo merges the eager scalars and this lazy payload
 * onto ONE object rather than creating a second, competing entity. That is
 * the same rule `BookValidationDocument` records (`~/graphql/book.ts`), and
 * it is why `page/book` passes the SAME `$libraryId`/`$bookId` variable
 * values to all three documents — the route param, not a value derived
 * some other way. A split that rendered correctly but forked the cache
 * entity would be a defect, not a style question.
 *
 * **Id rotation.** A book's global id is NOT stable: `applyEpubChanges`
 * (accept / replace / undo) and `bookRegenChapters` both re-import the
 * file and mint a NEW id. Every such path in this route navigates to the
 * new id (`UploadReplaceModal`'s `onReplaced(newId)` → `path.book(newId)`),
 * so the route param — and therefore this document's `$bookId` — changes
 * with it rather than going stale. Keying this query on the route param is
 * what makes that automatic; keying it on a value captured when the modal
 * opened would not be.
 *
 * Measured: breadth 11 (11.0%), complexity 11 (0.0%) of budget.
 */
export const BookChaptersDocument = graphql(`
  query BookChapters($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          chapterNames
          chapterSpineMap
        }
      }
    }
  }
`);

/**
 * `BookLineageModal`'s own data — the largest block the eager document used
 * to carry, and read by nothing else on this route. Same gate and same
 * prefetch as `BookChaptersDocument`, and the same cache-identity
 * contract: identical root, `id` selected, so it merges onto the existing
 * `Book:<id>` entity rather than competing with it. That shared entity is
 * also what makes `bookUnlinkDocument`'s `book { id lineage { … } }`
 * payload land here for free — it re-selects the full list onto the same
 * key, which is how an unlinked row disappears with no refetch
 * (`book-lineage-modal/index.test.tsx`).
 *
 * `addedAt` travels WITH `lineage` rather than staying eager: its only
 * consumer on this route is `BookLineageModal`'s `addedAt` prop (the
 * fallback timestamp for the oldest row), which is meaningless without the
 * lineage list it labels. Verified by reading every `addedAt` reference in
 * `./index.tsx` — there is exactly one, on that modal.
 *
 * `...LineageEntryFragment` is spread from `~/graphql/book.ts` rather than
 * colocated into `control/book-lineage-modal`: it has TWO spread sites in
 * two different modules (this document and `BookUnlinkDocumentDocument`),
 * which makes it a shared leaf, and every file under `~/graphql/` imports
 * only `~/gql`. Moving it into the modal would force `~/graphql/book.ts` to
 * import a component and close a real import cycle back through that
 * modal's own subtree (`book-lineage-row → book-lineage-merge-row →
 * unlink-book-lineage-button → ~/graphql/book.ts`) — exactly the hazard
 * `src/test-utils.tsx`'s standing note warns about.
 *
 * Measured: breadth 17 (17.0%), complexity 131 (0.4%) of budget.
 */
export const BookLineageDocument = graphql(`
  query BookLineage($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          addedAt
          lineage {
            ...LineageEntryFragment
          }
        }
      }
    }
  }
`);
