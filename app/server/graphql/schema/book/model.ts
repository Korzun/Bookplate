import {
  epochToDate,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
  parseStringArray,
} from '../../derive';
import { builder } from '../builder';
import { model as identifier } from '../identifier';
import { findUnique } from './node-loader';

export const model = builder.prismaNode('Book', {
  id: { field: 'userId_id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    // The raw content-hash id, alongside the Relay global `id`.
    //
    // Not redundant with `id`: four sibling fields in this schema already
    // carry this exact value as an opaque string — `Progress.document`,
    // `PendingFixSummary.bookId`, `LinkedDocument.oldId`/`newId` — and
    // `Library.book(id:)` takes it as an argument. Without this field a
    // client holding a `Book` cannot join to any of them, cannot re-fetch
    // itself through `Library.book(id:)`, and cannot build the cover,
    // thumbnail or download URLs (which are `/api/books/<this>/...`).
    //
    // `Book.id` cannot serve that purpose: it is a base64 global ID over
    // `JSON.stringify([userId, id])`, so extracting the hash from it client-
    // side would mean re-implementing Pothos's compound-id encoding.
    bookId: t.exposeString('id'),

    title: t.exposeString('title'),
    titleSort: t.exposeString('titleSort'),
    author: t.exposeString('author'),
    authorSort: t.exposeString('authorSort'),
    description: t.exposeString('description'),
    publisher: t.exposeString('publisher'),
    publishDate: t.exposeString('publishDate'),
    seriesIndex: t.exposeFloat('seriesIndex'),
    size: t.exposeInt('size'),
    pageCount: t.exposeInt('pageCount'),
    chapterCount: t.exposeInt('chapterCount'),

    subjects: t.field({ type: ['String'], resolve: (book) => parseStringArray(book.subjects) }),
    identifiers: t.field({
      type: [identifier],
      resolve: (book) => parseIdentifiers(book.identifiers),
    }),
    chapterSpineMap: t.field({
      type: ['Int'],
      resolve: (book) => parseNumberArray(book.chapterSpineMap),
    }),
    chapterNames: t.field({
      type: ['String'],
      nullable: true,
      resolve: (book) => parseNullableStringArray(book.chapterNames),
    }),

    mtime: t.field({ type: 'DateTime', resolve: (book) => epochToDate(book.mtime) }),
    addedAt: t.field({ type: 'DateTime', resolve: (book) => epochToDate(book.addedAt) }),

    hasCover: t.boolean({ resolve: (book) => book.coverMime !== null }),
    coverUrl: t.string({ resolve: (book) => `/api/books/${book.id}/cover` }),
    downloadUrl: t.string({ resolve: (book) => `/api/books/${book.id}/download` }),
    thumbnailUrl: t.string({
      args: { width: t.arg.int({ required: true }) },
      resolve: (book, args) => `/api/books/${book.id}/cover?width=${args.width}`,
    }),
  }),
});
