import {
  epochToDate,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
  parseStringArray,
} from '../../derive';
import { builder } from '../builder';
import { findUnique } from './node-loader';

const identifier = builder.objectRef<{ scheme: string; value: string }>('Identifier').implement({
  fields: (t) => ({
    scheme: t.exposeString('scheme'),
    value: t.exposeString('value'),
  }),
});

export const model = builder.prismaNode('Book', {
  id: { field: 'userId_id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
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
