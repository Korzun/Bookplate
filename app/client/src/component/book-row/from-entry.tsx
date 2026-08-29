import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { graphql, useFragment, type FragmentType } from '~/gql';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { path } from '~/router';

import { BookRow } from './index';

/**
 * Colocated: this component declares exactly the fields it renders, and
 * `page/library` composes it into `LibraryEntriesDocument` (spread by NAME
 * inside `... on Book { ...BookRowFragment }` — codegen resolves that
 * against this `graphql(...)` definition without a JS import between the
 * two files). `progress { percentage }` is what lets `BookRowFromEntry`
 * below render the row's progress badge WITHOUT a second, per-row fetch —
 * see that component's own doc comment.
 *
 * `LibraryEntries` nests this fragment under `Library.entries`, a
 * variable-`$first` connection priced at its `maxSize` (100) — see
 * `page/library/index.tsx`'s `LibraryEntriesDocument` doc comment for the
 * composed document's full cost accounting (this fragment's own fields
 * ride that ×100 multiplier).
 */
export const BookRowFragment = graphql(`
  fragment BookRowFragment on Book {
    id
    title
    author
    seriesIndex
    hasCover
    thumbnailUrl(width: 88)
    progress {
      id
      percentage
    }
  }
`);

interface BookRowFromEntryProps {
  asCard?: boolean;
  showAuthor?: boolean;
  book: FragmentType<typeof BookRowFragment>;
}

/**
 * The grid's adapter: unmasks `BookRowFragment` and renders the purely
 * presentational `BookRow`. `page/library` deliberately hands each row a
 * MASKED ref per edge rather than unmasking centrally (`LibraryEntryEdge`'s
 * doc comment there) — the reason is this component: it calls `useFragment`
 * exactly once, unconditionally, in its own body, which is its own render
 * context. One `<BookRowFromEntry>` per grid row sidesteps the
 * `react-hooks/rules-of-hooks` collision a shared per-edge unmask (inside a
 * `.map()`) would hit — codegen's `useFragment` is a plain identity cast
 * today (`gql/fragment-masking.ts`), not a real hook, but the lint rule
 * can't tell that apart from Apollo's.
 *
 * Calls no book/progress data hook: `BookRowFragment` already carries
 * `progress { percentage }`, so calling `useMyProgress` here would be a
 * second, redundant fetch of data the parent's `LibraryEntries` query
 * already has — exactly the pattern this task removes. The only hook beyond
 * `useFragment` is `useAuthorizedSrc`, which authorizes the REST cover
 * *image* fetch (a binary endpoint, not book data) against the
 * server-built `thumbnailUrl` — already scoped with the correct `?user=`/`v=`
 * suffix, so no `withTargetUser()` wrapping is needed here.
 *
 * `unmasked.id` is `Book`'s Relay global ID (`builder.prismaNode('Book', {
 * id: { field: 'userId_id' } ... })`, server-side), not the raw content-hash
 * id `page/book` was originally built against, so `path.book(unmasked.id)`
 * below carries the global form. `page/book` reads GraphQL, and the two
 * remaining REST routes that still take a book id in the path
 * (`/api/books/:id/cover` and `/api/books/:id/download`) accept EITHER form
 * — `routes/ui.ts`'s `resolveBookLocalId` resolves a global id to the raw
 * one before the handler reads the book.
 */
export function BookRowFromEntry({ asCard, showAuthor, book }: BookRowFromEntryProps) {
  const navigate = useNavigate();
  const unmasked = useFragment(BookRowFragment, book);
  const coverSrc = useAuthorizedSrc(unmasked.hasCover ? unmasked.thumbnailUrl : null);
  const handleNavigate = useCallback(() => {
    navigate(path.book(unmasked.id));
  }, [navigate, unmasked.id]);

  return (
    <BookRow
      asCard={asCard}
      showAuthor={showAuthor}
      title={unmasked.title}
      author={unmasked.author}
      seriesIndex={unmasked.seriesIndex}
      hasCover={unmasked.hasCover}
      coverSrc={coverSrc}
      progressPercentage={unmasked.progress?.percentage}
      onClick={handleNavigate}
    />
  );
}
