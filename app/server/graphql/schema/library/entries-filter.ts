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

const ratingMinimums = builder.inputType('RatingMinimums', {
  description: 'Minimum rating per dimension, 1–5. Dimensions left null are not filtered.',
  fields: (t) => ({
    overall: t.int({ required: false }),
    story: t.int({ required: false }),
    characters: t.int({ required: false }),
    writing: t.int({ required: false }),
    ideas: t.int({ required: false }),
  }),
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
    minRating: t.field({
      type: ratingMinimums,
      required: false,
      description: 'Keep books (and series with a book) meeting every minimum given.',
    }),
    unrated: t.boolean({
      required: false,
      description: 'Keep books (and series with a book) that have no overall rating.',
    }),
  }),
});
