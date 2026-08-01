import { builder } from '../builder';

const libraryEntryStatus = builder.enumType('LibraryEntryStatus', {
  values: {
    NOT_STARTED: { value: 'not-started' },
    IN_PROGRESS: { value: 'in-progress' },
    COMPLETED: { value: 'completed' },
  },
});

const libraryEntryType = builder.enumType('LibraryEntryType', {
  values: {
    SERIES: { value: 'series' },
    STANDALONE: { value: 'standalone' },
  },
});

/** Mirrors `BookListFilters` (types.ts) field-for-field — see that type's doc comment before changing either. */
export const libraryFilter = builder.inputType('LibraryFilter', {
  fields: (t) => ({
    query: t.string({ required: false }),
    author: t.string({ required: false }),
    seriesName: t.string({ required: false }),
    status: t.field({ type: libraryEntryStatus, required: false }),
    subjects: t.stringList({ required: false }),
    entryType: t.field({ type: libraryEntryType, required: false }),
  }),
});
