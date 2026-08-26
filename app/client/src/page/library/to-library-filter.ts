import type { LibraryEntryStatus, LibraryEntryType, LibraryFilter } from '~/gql/graphql';
import type { BookListFilter } from '~/lib/book-types';

const STATUS_MAP: Record<NonNullable<BookListFilter['status']>, LibraryEntryStatus> = {
  'not-started': 'NOT_STARTED',
  'in-progress': 'IN_PROGRESS',
  completed: 'COMPLETED',
};

const ENTRY_TYPE_MAP: Record<NonNullable<BookListFilter['entryType']>, LibraryEntryType> = {
  series: 'SERIES',
  standalone: 'STANDALONE',
};

/**
 * Maps the URL-state `BookListFilter` (`useBookListFilter`, unchanged by
 * this task — it is URL state, not server state) onto the GraphQL
 * `LibraryFilter` input `./index.tsx`'s `LibraryPage` sends over the wire
 * (via `usePaginatedConnection`'s `variables.filter`).
 *
 * `query`/`author`/`seriesName`/`subjects` pass through unchanged — same
 * shape on both sides. `status`/`entryType` don't: the client filter spells
 * them lowercase-hyphenated (`'not-started'`, `'in-progress'`, `'series'`,
 * `'standalone'`), the GraphQL enum spells them SCREAMING_SNAKE_CASE
 * (`NOT_STARTED`, `IN_PROGRESS`, `SERIES`, `STANDALONE`). Getting this
 * wrong doesn't error — Apollo would send whatever string is here as the
 * enum value, the server rejects an unrecognized one at the variable-coercion
 * layer for a genuinely bogus value, but a wrong-but-plausible casing choice
 * (e.g. accidentally uppercasing without the underscore) can just as easily
 * fail to match any real entry and silently render an empty grid — exactly
 * the failure mode this function exists to close off with an explicit,
 * tested table rather than an inline `.toUpperCase()`.
 */
export function toLibraryFilter(filter: BookListFilter): LibraryFilter {
  return {
    query: filter.query,
    author: filter.author,
    seriesName: filter.seriesName,
    subjects: filter.subjects,
    status: filter.status ? STATUS_MAP[filter.status] : undefined,
    entryType: filter.entryType ? ENTRY_TYPE_MAP[filter.entryType] : undefined,
  };
}
