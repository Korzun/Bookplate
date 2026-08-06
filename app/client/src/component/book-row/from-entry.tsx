import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useFragment, type FragmentType } from '~/gql';
import { BookRowFragment } from '~/graphql/library';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { path } from '~/router';

import { BookRow } from './index';

interface BookRowFromEntryProps {
  asCard?: boolean;
  showAuthor?: boolean;
  book: FragmentType<typeof BookRowFragment>;
}

/**
 * The grid's adapter: unmasks `BookRowFragment` and renders the purely
 * presentational `BookRow`. `useLibraryEntries`/`LibraryEntryEdge`
 * deliberately return a MASKED ref per edge rather than unmasking centrally
 * (`provider/library/hook/use-library-entries.ts`'s doc comment) — the
 * reason is this component: it calls `useFragment` exactly once,
 * unconditionally, in its own body, which is its own render context. One
 * `<BookRowFromEntry>` per grid row sidesteps the `react-hooks/rules-of-hooks`
 * collision a shared per-edge unmask (inside a `.map()`) would hit — codegen's
 * `useFragment` is a plain identity cast today (`gql/fragment-masking.ts`),
 * not a real hook, but the lint rule can't tell that apart from Apollo's.
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
 * id `page/book` was built against — this component's own task-7 doc
 * comment used to warn that a click from a GraphQL-rendered grid row might
 * not resolve there. That gap closed two commits later, in task 13:
 * `/api/books/:id` (and four sibling REST routes — `routes/ui.ts`'s
 * `resolveBookLocalId`) now accepts EITHER form and resolves a global id to
 * the raw one before querying `bookStore`, so `path.book(unmasked.id)`
 * below reaches `page/book` correctly today, ahead of `page/book` itself
 * ever moving onto GraphQL.
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
